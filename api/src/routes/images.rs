use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use std::time::{Duration, SystemTime};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::image_gc::collect_referenced_images;
use crate::services::s3::S3Error;
use crate::{
    models::{GcQuery, IsPublishedQuery},
    AppState,
};

/// Objects written more recently than this are never deleted by the GC
/// sweep: an in-flight upload-first save may have uploaded the image but not
/// yet written the manifest that references it, so a fresh object can look
/// orphaned while it is actually about to be referenced.
const GC_SAFETY_MARGIN: Duration = Duration::from_secs(60 * 60);

/// Longest client-supplied extension preserved on a generated object name.
/// Real image extensions are short (".jpeg", ".webp"); anything longer is
/// junk and is dropped rather than stored.
const MAX_EXTENSION_LEN: usize = 16;

/// Server-generated object name for an upload: a fresh UUID plus the
/// sanitized extension of the client's filename. The UUID makes distinct
/// uploads collision-proof regardless of what the client names its files
/// (issue #113); the extension is kept so `GET /images/:filename` can guess
/// the content type. `<uuid>.<ext>` matches the naming the UI already used,
/// so new keys are indistinguishable from existing ones.
fn unique_image_name(original: Option<&str>) -> String {
    let extension = original.map(sanitized_extension).unwrap_or_default();
    format!("{}{}", Uuid::new_v4(), extension)
}

/// The client filename's extension (lowercased, with leading dot), or empty
/// when there is no usable one. Only short, purely alphanumeric extensions
/// on a non-empty stem qualify — everything else (no dot, dotfiles like
/// ".png", trailing dots, path or control characters, overlong suffixes) is
/// dropped so no unvetted client bytes ever reach the S3 key.
fn sanitized_extension(file_name: &str) -> String {
    match file_name.rsplit_once('.') {
        Some((stem, ext))
            if !stem.is_empty()
                && !ext.is_empty()
                && ext.len() <= MAX_EXTENSION_LEN
                && ext.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            format!(".{}", ext.to_ascii_lowercase())
        }
        _ => String::new(),
    }
}

pub async fn get_image_handler(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> Result<Response, AppError> {
    let image_key = format!("images/{}", filename);

    match state.s3_service.get_object(&image_key).await {
        Ok(bytes) => {
            let content_type = mime_guess::from_path(&filename).first_or_octet_stream();
            Ok((
                StatusCode::OK,
                [("Content-Type", content_type.as_ref())],
                bytes,
            )
                .into_response())
        }
        Err(S3Error::NotFound) => Err(AppError::NotFound("Image not found")),
        Err(e) => Err(AppError::internal("Failed to fetch image", e)),
    }
}

pub async fn upload_image_handler(
    State(state): State<AppState>,
    Query(query): Query<IsPublishedQuery>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    // extract "isPublished" from query string
    let is_published = query.is_published;

    // Pull out the first field
    let mut field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        Ok(None) => return Err(AppError::BadRequest("No file found")),
        Err(e) => {
            tracing::error!("Error reading multipart field: {}", e);
            return Err(AppError::BadRequest("Invalid multipart"));
        }
    };

    // Never store under the client's filename: two uploads named "photo.jpg"
    // would silently overwrite each other, and deleting one post's image
    // could break another post that referenced the same key (#113). Generate
    // a unique name server-side and return it so the client references it.
    let original_name = field.file_name().map(|n| n.to_string());
    let file_name = unique_image_name(original_name.as_deref());
    let key = format!("images/{}", file_name);

    // Read entire stream into a Vec<u8>. A mid-stream error must fail the
    // upload — breaking out of the loop would store a truncated image.
    let mut data = Vec::new();
    loop {
        match field.chunk().await {
            Ok(Some(chunk)) => data.extend_from_slice(&chunk),
            Ok(None) => break,
            Err(e) => {
                tracing::error!("Error reading upload stream: {}", e);
                return Err(AppError::BadRequest("Failed to read uploaded file"));
            }
        }
    }

    state
        .s3_service
        .put_object(&key, data, is_published)
        .await
        .map_err(|e| AppError::internal("Failed to upload image", e))?;

    tracing::info!(
        "File uploaded successfully: {} (client name: {:?})",
        file_name,
        original_name
    );
    Ok(Json(serde_json::json!({
        "message": "File uploaded successfully",
        "fileName": file_name,
    })))
}

/// `GET /images` — list the file names of every uploaded image, newest
/// first, so the admin UI can offer already-uploaded images for reuse
/// (e.g. picking a site background). Admin-only: the listing includes
/// unpublished images.
pub async fn list_images_handler(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut objects = state
        .s3_service
        .list_objects("images/")
        .await
        .map_err(|e| AppError::internal("Failed to list images", e))?;

    // Newest first (the picker surfaces recent uploads); name as a
    // tie-breaker so the order is deterministic.
    objects.sort_by(|a, b| {
        b.last_modified
            .cmp(&a.last_modified)
            .then_with(|| a.key.cmp(&b.key))
    });

    let images: Vec<&str> = objects
        .iter()
        .filter_map(|object| object.key.strip_prefix("images/"))
        // The bare "images/" folder marker some S3 tools create.
        .filter(|name| !name.is_empty())
        .collect();

    Ok(Json(serde_json::json!({ "images": images })))
}

pub async fn set_image_published_handler(
    State(state): State<AppState>,
    Path(filename): Path<String>,
    Query(query): Query<IsPublishedQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let image_key = format!("images/{}", filename);

    match state
        .s3_service
        .set_object_tagging(&image_key, query.is_published)
        .await
    {
        Ok(_) => Ok(Json(serde_json::json!({
            "message": "Image published status updated"
        }))),
        Err(S3Error::NotFound) => Err(AppError::NotFound("Image not found")),
        Err(e) => Err(AppError::internal(
            "Failed to update image published status",
            e,
        )),
    }
}

/// `true` when the object is too recently written to delete safely. Unknown
/// or future timestamps are treated as recent — when in doubt, keep the file.
fn within_safety_margin(last_modified: Option<SystemTime>, now: SystemTime) -> bool {
    match last_modified {
        None => true,
        Some(modified) => match now.duration_since(modified) {
            Ok(age) => age < GC_SAFETY_MARGIN,
            // `modified` is in the future (clock skew): treat as recent.
            Err(_) => true,
        },
    }
}

/// `POST /images/gc?dry_run=<bool>` — sweep the `images/` prefix and delete
/// objects no longer referenced by any content manifest or blog post.
///
/// Defaults to dry-run: without `?dry_run=false` nothing is deleted, the
/// response only reports what a real run would do. Any failure to read a
/// manifest or blog content aborts the sweep with a 500 before any delete —
/// see `services::image_gc` for the safety model.
pub async fn gc_images_handler(
    State(state): State<AppState>,
    Query(query): Query<GcQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let refs = collect_referenced_images(state.s3_service.as_ref())
        .await
        .map_err(|e| AppError::internal("Image GC aborted before any delete", e))?;

    let objects = state
        .s3_service
        .list_objects("images/")
        .await
        .map_err(|e| AppError::internal("Image GC aborted: failed to list images", e))?;

    let now = SystemTime::now();
    let mut referenced = Vec::new();
    let mut orphaned = Vec::new();
    let mut skipped_recent = Vec::new();
    for object in objects {
        let Some(name) = object.key.strip_prefix("images/") else {
            continue;
        };
        // The bare "images/" folder marker some S3 tools create.
        if name.is_empty() {
            continue;
        }
        if refs.contains(name) {
            referenced.push(object.key);
        } else if within_safety_margin(object.last_modified, now) {
            skipped_recent.push(object.key);
        } else {
            orphaned.push(object.key);
        }
    }
    referenced.sort();
    orphaned.sort();
    skipped_recent.sort();

    let mut deleted = Vec::new();
    if !query.dry_run {
        for key in &orphaned {
            // Abort on the first failed delete. Everything already deleted
            // was a proven orphan, so a partial sweep is safe; the next run
            // picks up where this one stopped.
            state.s3_service.delete_object(key).await.map_err(|e| {
                AppError::internal("Image GC: delete failed partway; re-run to finish", e)
            })?;
            deleted.push(key.clone());
        }
        tracing::info!(
            "Image GC deleted {} orphaned object(s) ({} referenced, {} skipped as recent)",
            deleted.len(),
            referenced.len(),
            skipped_recent.len()
        );
    }

    Ok(Json(serde_json::json!({
        "dry_run": query.dry_run,
        "referenced": referenced,
        "orphaned": orphaned,
        "skipped_recent": skipped_recent,
        "deleted": deleted,
    })))
}
