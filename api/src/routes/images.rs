use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};

use crate::error::AppError;
use crate::services::s3::S3Error;
use crate::{models::IsPublishedQuery, AppState};

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

    // Get original filename
    let file_name = field
        .file_name()
        .map(|n| n.to_string())
        .unwrap_or_else(|| "upload_file".to_string());
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

    tracing::info!("File uploaded successfully: {}", file_name);
    Ok(Json(serde_json::json!({
        "message": "File uploaded successfully"
    })))
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

pub async fn delete_image_handler(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let image_key = format!("images/{}", filename);

    // S3 deletes are idempotent and never report NotFound.
    match state.s3_service.delete_object(&image_key).await {
        Ok(_) => Ok(Json(serde_json::json!({
            "message": "Image deleted successfully"
        }))),
        Err(e) => Err(AppError::internal("Failed to delete image", e)),
    }
}
