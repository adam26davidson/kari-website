use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::PhotographyPost;
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn get_photography_handler(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    let posts: Vec<PhotographyPost> = match state.s3_service.get_object("photography.json").await {
        // A parse failure must NOT become an empty list: the admin UI would
        // render an empty editor and a save would wipe the data.
        Ok(data) => serde_json::from_slice(&data)
            .map_err(|e| AppError::internal("Stored photography data is invalid", e))?,
        // The object not existing yet is a legitimate empty list (new site).
        Err(S3Error::NotFound) => Vec::new(),
        Err(e) => return Err(AppError::internal("Failed to fetch photography", e)),
    };
    Ok(Json(json!(posts)))
}

pub async fn update_photography_handler(
    State(state): State<AppState>,
    Json(posts): Json<Vec<PhotographyPost>>,
) -> Result<Json<Value>, AppError> {
    let posts_str = serde_json::to_string(&posts)
        .map_err(|e| AppError::internal("Failed to serialize photography posts", e))?;

    state
        .s3_service
        .put_object("photography.json", posts_str.into(), true)
        .await
        .map_err(|e| AppError::internal("Failed to update photography posts", e))?;

    Ok(Json(json!({"message": "Photography posts updated"})))
}
