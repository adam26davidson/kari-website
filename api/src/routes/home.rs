use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::HomePageData;
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn get_home_page_handler(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    match state.s3_service.get_object("home-page.json").await {
        // A parse failure must NOT be a 200: the admin editor would load
        // garbage and a save would overwrite the real data.
        Ok(data) => {
            let home_page_data: HomePageData = serde_json::from_slice(&data)
                .map_err(|e| AppError::internal("Stored home page data is invalid", e))?;
            Ok(Json(json!(home_page_data)))
        }
        // The object not existing yet is a legitimate blank home page.
        Err(S3Error::NotFound) => Ok(Json(json!({"photo": "", "blurb": ""}))),
        Err(e) => Err(AppError::internal("Failed to fetch home page data", e)),
    }
}

pub async fn update_home_page_handler(
    State(state): State<AppState>,
    Json(home_page_data): Json<HomePageData>,
) -> Result<Json<Value>, AppError> {
    let home_page_data_str = serde_json::to_string(&home_page_data)
        .map_err(|e| AppError::internal("Failed to serialize home page data", e))?;

    state
        .s3_service
        .put_object("home-page.json", home_page_data_str.into(), true)
        .await
        .map_err(|e| AppError::internal("Failed to update home page data", e))?;

    Ok(Json(json!({"message": "Home page data updated"})))
}
