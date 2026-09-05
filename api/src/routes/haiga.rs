use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::Haiga;
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn get_haiga_handler(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let haiga: Vec<Haiga> = match state.s3_service.get_object("haiga.json").await {
        // A parse failure must NOT become an empty list: the admin UI would
        // render an empty editor and a save would wipe the data.
        Ok(data) => serde_json::from_slice(&data)
            .map_err(|e| AppError::internal("Stored haiga data is invalid", e))?,
        // The object not existing yet is a legitimate empty list (new site).
        Err(S3Error::NotFound) => Vec::new(),
        Err(e) => return Err(AppError::internal("Failed to fetch haiga", e)),
    };
    Ok(Json(json!(haiga)))
}

pub async fn update_haiga_handler(
    State(state): State<AppState>,
    Json(haiga): Json<Vec<Haiga>>,
) -> Result<Json<Value>, AppError> {
    let haiga_str = serde_json::to_string(&haiga)
        .map_err(|e| AppError::internal("Failed to serialize haiga", e))?;

    state
        .s3_service
        .put_object("haiga.json", haiga_str.into(), true)
        .await
        .map_err(|e| AppError::internal("Failed to update haiga", e))?;

    Ok(Json(json!({"message": "Haiga list updated"})))
}
