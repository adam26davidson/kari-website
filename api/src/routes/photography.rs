use axum::{extract::State, http::StatusCode, response::Json};
use serde_json::{json, Value};

use crate::models::PhotographyPost;
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn get_photography_handler(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match state.s3_service.get_object("photography.json").await {
        Ok(data) => match serde_json::from_slice::<Vec<PhotographyPost>>(&data) {
            Ok(posts) => (StatusCode::OK, Json(json!(posts))),
            // A parse failure must NOT become an empty list: the admin UI
            // would render an empty editor and a save would wipe the data.
            Err(e) => {
                eprintln!("Error parsing photography.json: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Stored photography data is invalid"})),
                )
            }
        },
        // The object not existing yet is a legitimate empty list (new site).
        Err(S3Error::NotFound) => (StatusCode::OK, Json(json!([]))),
        Err(e) => {
            eprintln!("Error fetching photography: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to fetch photography"})),
            )
        }
    }
}

pub async fn update_photography_handler(
    State(state): State<AppState>,
    Json(posts): Json<Vec<PhotographyPost>>,
) -> (StatusCode, Json<Value>) {
    let posts_str = serde_json::to_string(&posts).unwrap();

    match state
        .s3_service
        .put_object("photography.json", posts_str.as_bytes().to_vec(), true)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"message": "Photography posts updated"})),
        ),
        Err(e) => {
            eprintln!("Error updating photography: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update photography posts"})),
            )
        }
    }
}
