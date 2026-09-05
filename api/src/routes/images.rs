use axum::{
    extract::{rejection::QueryRejection, Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use bytes::Bytes;
use std::collections::BTreeMap;
use std::time::{Duration, SystemTime};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::error::AppError;
use crate::services::image_gc::collect_referenced_images;
use crate::services::image_keys::{
    id_from_key, legacy_key, original_key, prefix, sanitized_extension, variant_key, ImageVariant,
};
use crate::services::object_store::ObjectMeta;
use crate::services::s3::S3Error;
use crate::services::thumbnail::make_renditions;
use crate::{
    models::{GcQuery, ImageQuery, IsPublishedQuery},
    AppState,
};

/// Objects written more recently than this are never deleted by the GC
/// sweep: an in-flight upload-first save may have uploaded the image but not
/// yet written the manifest that references it, so a fresh object can look
/// orphaned while it is actually about to be referenced.
const GC_SAFETY_MARGIN: Duration = Duration::from_secs(60 * 60);

/// Only one image is decoded at a time, process-wide.
///
/// Rendition generation is the memory peak of the whole API — see
/// [`MAX_DECODE_BYTES`](crate::services::thumbnail::MAX_DECODE_BYTES) for
/// the budget — and `spawn_blocking`'s pool is effectively unbounded, so
/// without this N simultaneous uploads cost N times that peak. This API runs
/// on a micro EC2 host alongside a second copy of itself, so the peak has to
/// be a property of the process rather than of the request rate. There is
/// exactly one admin: a second concurrent upload waits a few seconds, and
/// its original is already stored by then either way.
///
/// The permit covers the decode ONLY — never the body read or the S3 puts,
/// which are I/O-bound and hold no pixel buffers.
static RENDITION_GATE: Semaphore = Semaphore::const_new(1);

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

/// The keys to try, in order, when serving image `id` at `size`.
///
/// A requested variant that does not exist falls back to the original, and
/// the original falls back to the pre-#273 single-object key — so an image
/// whose renditions failed to generate, and a bucket that has not been
/// migrated yet, both still render (just at full size).
fn serving_candidates(id: &str, size: Option<ImageVariant>) -> Vec<String> {
    let mut keys = Vec::with_capacity(3);
    if let Some(variant) = size {
        keys.push(variant_key(id, variant));
    }
    keys.push(original_key(id));
    keys.push(legacy_key(id));
    keys
}

pub async fn get_image_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: Result<Query<ImageQuery>, QueryRejection>,
) -> Result<Response, AppError> {
    // The variant set is closed, so a bogus `?size=` is a client error —
    // reported through AppError so the body keeps the app's JSON shape.
    let Query(query) = query.map_err(|_| AppError::BadRequest("Unknown image size"))?;

    for key in serving_candidates(&id, query.size) {
        match state.s3_service.get_object(&key).await {
            Ok(bytes) => {
                // Guess from the key actually served, not from the id: a
                // thumbnail of "photo.png" is a JPEG.
                let content_type = mime_guess::from_path(&key).first_or_octet_stream();
                return Ok((
                    StatusCode::OK,
                    [("Content-Type", content_type.as_ref())],
                    bytes,
                )
                    .into_response());
            }
            Err(S3Error::NotFound) => continue,
            Err(e) => return Err(AppError::internal("Failed to fetch image", e)),
        }
    }
    Err(AppError::NotFound("Image not found"))
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
    let key = original_key(&file_name);

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

    // Buffered exactly once from here on: the put and the rendition decode
    // both need the whole body, and `Bytes` hands the second one a refcount
    // instead of a second copy of a file that can now be 25 MB (#706).
    let data = Bytes::from(data);

    // The original is stored BEFORE any rendition, and deliberately so: the
    // GC safety margin above assumes it, and an upload whose decode fails or
    // panics must still leave the original in the bucket. Do not restructure
    // this into generate-then-put.
    state
        .s3_service
        .put_object(&key, data.clone(), is_published)
        .await
        .map_err(|e| AppError::internal("Failed to upload image", e))?;

    store_renditions(&state, &file_name, data, is_published).await;

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

/// Generate and store every derived rendition of a freshly uploaded image.
///
/// Deliberately infallible from the caller's point of view: an image the
/// decoder cannot read (an unsupported format, a corrupt file) or a failed
/// write must not fail an upload whose original is already stored, because
/// `GET /images/:id?size=…` falls back to the original. Failures are
/// logged, not returned — and one variant failing to store does not stop
/// the others being written.
async fn store_renditions(state: &AppState, id: &str, data: Bytes, is_published: bool) {
    // Decoding a camera original allocates hundreds of megabytes and takes
    // real CPU: never on the async runtime's thread. One blocking task for
    // all variants, so the decode is paid for once.
    //
    // Scoped so the permit is released before the S3 puts below: holding it
    // across network I/O would serialize uploads for no memory benefit.
    let generated = {
        let _permit = RENDITION_GATE
            .acquire()
            .await
            .expect("the rendition gate is a static and is never closed");
        tokio::task::spawn_blocking(move || make_renditions(&data)).await
    };
    let renditions = match generated {
        Ok(Ok(renditions)) => renditions,
        Ok(Err(e)) => {
            tracing::warn!("No renditions stored for {}: {}", id, e);
            return;
        }
        Err(e) => {
            tracing::warn!("Rendition generation panicked for {}: {}", id, e);
            return;
        }
    };
    for (variant, bytes) in renditions {
        let key = variant_key(id, variant);
        if let Err(e) = state
            .s3_service
            .put_object(&key, bytes.into(), is_published)
            .await
        {
            tracing::warn!("Failed to store {}: {}", key, e);
        }
    }
}

/// Group listed `images/` objects by the image id they belong to, in id
/// order. Both layouts land in the same group: a legacy `images/<id>` object
/// and every object under `images/<id>/` describe one image.
fn group_by_image_id(objects: Vec<ObjectMeta>) -> BTreeMap<String, Vec<ObjectMeta>> {
    let mut groups: BTreeMap<String, Vec<ObjectMeta>> = BTreeMap::new();
    for object in objects {
        // Skips the bare "images/" folder marker some S3 tools create.
        let Some(id) = id_from_key(&object.key) else {
            continue;
        };
        groups.entry(id.to_string()).or_default().push(object);
    }
    groups
}

/// `GET /images` — list the file names of every uploaded image, newest
/// first, so the admin UI can offer already-uploaded images for reuse
/// (e.g. picking a site background). Admin-only: the listing includes
/// unpublished images.
pub async fn list_images_handler(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let objects = state
        .s3_service
        .list_objects("images/")
        .await
        .map_err(|e| AppError::internal("Failed to list images", e))?;

    // One entry per image, however many renditions it stores. A prefix is
    // as new as its newest object, so an image sorts by when it was
    // uploaded rather than by which rendition happened to be written last.
    let mut images: Vec<(Option<SystemTime>, String)> = group_by_image_id(objects)
        .into_iter()
        .map(|(id, objects)| {
            let newest = objects.iter().filter_map(|o| o.last_modified).max();
            (newest, id)
        })
        .collect();

    // Newest first (the picker surfaces recent uploads); id as a
    // tie-breaker so the order is deterministic.
    images.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));

    let images: Vec<String> = images.into_iter().map(|(_, id)| id).collect();

    Ok(Json(serde_json::json!({ "images": images })))
}

/// `PUT /images/:id/set-published` — flip the `public=` tag on EVERY object
/// belonging to the image.
///
/// A public reference to a variant needs that variant's own object tagged,
/// so the whole directory flips together; the pre-#273 single object is
/// flipped too, so a bucket mid-migration never ends up half-visible.
pub async fn set_image_published_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<IsPublishedQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let failed = |e| AppError::internal("Failed to update image published status", e);

    let objects = state
        .s3_service
        .list_objects(&prefix(&id))
        .await
        .map_err(failed)?;

    // Tag the original first: a partial failure must never leave a public
    // thumbnail of an image whose original is still private.
    let original = original_key(&id);
    let mut keys: Vec<String> = objects.into_iter().map(|object| object.key).collect();
    keys.sort_by_key(|key| *key != original);

    let mut tagged = 0usize;
    for key in &keys {
        state
            .s3_service
            .set_object_tagging(key, query.is_published)
            .await
            .map_err(failed)?;
        tagged += 1;
    }

    // The legacy object is not under the prefix, so it is listed separately;
    // its absence is the normal case for anything uploaded after migration.
    match state
        .s3_service
        .set_object_tagging(&legacy_key(&id), query.is_published)
        .await
    {
        Ok(()) => tagged += 1,
        Err(S3Error::NotFound) => {}
        Err(e) => return Err(failed(e)),
    }

    if tagged == 0 {
        return Err(AppError::NotFound("Image not found"));
    }
    Ok(Json(serde_json::json!({
        "message": "Image published status updated"
    })))
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

/// One image in a GC report: the id the admin UI counts, and every object
/// key that image stores.
///
/// The sweep classifies per image, so the report does too — an image in the
/// directory layout stores an original and a thumbnail, and reporting bare
/// keys made the admin page say "2 orphaned images" for one picture (#454).
#[derive(serde::Serialize, Clone)]
struct GcImageGroup {
    id: String,
    keys: Vec<String>,
}

/// `POST /images/gc?dry_run=<bool>` — sweep the `images/` prefix and delete
/// objects no longer referenced by any content manifest or blog post.
///
/// Defaults to dry-run: without `?dry_run=false` nothing is deleted, the
/// response only reports what a real run would do. Any failure to read a
/// manifest or blog content aborts the sweep with a 500 before any delete —
/// see `services::image_gc` for the safety model.
///
/// `referenced`, `orphaned`, `skipped_recent` and `deleted` each list one
/// `{ id, keys }` entry per IMAGE, in id order, with that image's object
/// keys sorted within it.
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
    // Classify per IMAGE, not per object: an image is referenced (or
    // orphaned) as a whole, and one recent member — an original whose
    // thumbnail is still being written — protects the entire prefix from a
    // half-written state being swept.
    // Groups arrive in id order from the BTreeMap, so no sort over them.
    for (id, objects) in group_by_image_id(objects) {
        let mut keys: Vec<String> = objects.iter().map(|object| object.key.clone()).collect();
        keys.sort();
        let group = GcImageGroup {
            id: id.clone(),
            keys,
        };
        if refs.contains(&id) {
            referenced.push(group);
        } else if objects
            .iter()
            .any(|object| within_safety_margin(object.last_modified, now))
        {
            skipped_recent.push(group);
        } else {
            orphaned.push(group);
        }
    }

    let mut deleted: Vec<GcImageGroup> = Vec::new();
    if !query.dry_run {
        for image in &orphaned {
            for key in &image.keys {
                // Abort on the first failed delete. Everything already
                // deleted was a proven orphan, so a partial sweep is safe;
                // the next run picks up where this one stopped.
                state.s3_service.delete_object(key).await.map_err(|e| {
                    AppError::internal("Image GC: delete failed partway; re-run to finish", e)
                })?;
            }
            // Reported only once the whole image is gone: a partly deleted
            // image is not a deleted image.
            deleted.push(image.clone());
        }
        let objects: usize = deleted.iter().map(|image| image.keys.len()).sum();
        tracing::info!(
            "Image GC deleted {} orphaned image(s), {} object(s) ({} referenced, {} skipped as recent)",
            deleted.len(),
            objects,
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
