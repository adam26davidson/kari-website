use axum::{extract::State, http::StatusCode, response::Json};
use serde_json::{json, Value};

use crate::models::Haiku;
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn get_haiku_handler(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match state.s3_service.get_object("haiku.json").await {
        Ok(data) => match serde_json::from_slice::<Vec<Haiku>>(&data) {
            Ok(haiku) => (StatusCode::OK, Json(json!(haiku))),
            // A parse failure must NOT become an empty list: the admin UI
            // would render an empty editor and a save would wipe the data.
            Err(e) => {
                eprintln!("Error parsing haiku.json: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Stored haiku data is invalid"})),
                )
            }
        },
        // The object not existing yet is a legitimate empty list (new site).
        Err(S3Error::NotFound) => (StatusCode::OK, Json(json!([]))),
        Err(e) => {
            eprintln!("Error fetching haiku: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to fetch haiku"})),
            )
        }
    }
}

pub async fn update_haiku_handler(
    State(state): State<AppState>,
    Json(haiku): Json<Vec<Haiku>>,
) -> (StatusCode, Json<Value>) {
    let haiku_str = serde_json::to_string(&haiku).unwrap();

    match state
        .s3_service
        .put_object("haiku.json", haiku_str.as_bytes().to_vec(), true)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"message": "Haiku list updated"})),
        ),
        Err(e) => {
            eprintln!("Error updating haiku: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update haiku"})),
            )
        }
    }
}
