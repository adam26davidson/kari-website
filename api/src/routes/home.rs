use axum::{extract::State, http::StatusCode, response::Json};
use serde_json::{json, Value};

use crate::models::HomePageData;
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn get_home_page_handler(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match state.s3_service.get_object("home-page.json").await {
        Ok(data) => match serde_json::from_slice::<HomePageData>(&data) {
            Ok(home_page_data) => (StatusCode::OK, Json(json!(home_page_data))),
            // A parse failure must NOT be a 200: the admin editor would load
            // garbage and a save would overwrite the real data.
            Err(e) => {
                eprintln!("Error parsing home page data: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Stored home page data is invalid"})),
                )
            }
        },
        // The object not existing yet is a legitimate blank home page.
        Err(S3Error::NotFound) => (StatusCode::OK, Json(json!({"photo": "", "blurb": ""}))),
        Err(e) => {
            eprintln!("Error fetching home page data: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to fetch home page data"})),
            )
        }
    }
}

pub async fn update_home_page_handler(
    State(state): State<AppState>,
    Json(home_page_data): Json<HomePageData>,
) -> (StatusCode, Json<Value>) {
    let home_page_data_str = serde_json::to_string(&home_page_data).unwrap();

    match state
        .s3_service
        .put_object(
            "home-page.json",
            home_page_data_str.as_bytes().to_vec(),
            true,
        )
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"message": "Home page data updated"})),
        ),
        Err(e) => {
            eprintln!("Error updating home page data: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update home page data"})),
            )
        }
    }
}
