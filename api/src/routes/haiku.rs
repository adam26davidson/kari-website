use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::Haiku;
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn get_haiku_handler(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let haiku: Vec<Haiku> = match state.s3_service.get_object("haiku.json").await {
        // A parse failure must NOT become an empty list: the admin UI would
        // render an empty editor and a save would wipe the data.
        Ok(data) => serde_json::from_slice(&data)
            .map_err(|e| AppError::internal("Stored haiku data is invalid", e))?,
        // The object not existing yet is a legitimate empty list (new site).
        Err(S3Error::NotFound) => Vec::new(),
        Err(e) => return Err(AppError::internal("Failed to fetch haiku", e)),
    };
    Ok(Json(json!(haiku)))
}

pub async fn update_haiku_handler(
    State(state): State<AppState>,
    Json(haiku): Json<Vec<Haiku>>,
) -> Result<Json<Value>, AppError> {
    let haiku_str = serde_json::to_string(&haiku)
        .map_err(|e| AppError::internal("Failed to serialize haiku", e))?;

    state
        .s3_service
        .put_object("haiku.json", haiku_str.into(), true)
        .await
        .map_err(|e| AppError::internal("Failed to update haiku", e))?;

    Ok(Json(json!({"message": "Haiku list updated"})))
}
