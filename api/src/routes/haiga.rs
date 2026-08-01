use axum::{extract::State, http::StatusCode, response::Json};
use serde_json::{json, Value};

use crate::models::Haiga;
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn get_haiga_handler(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match state.s3_service.get_object("haiga.json").await {
        Ok(data) => match serde_json::from_slice::<Vec<Haiga>>(&data) {
            Ok(haiga) => (StatusCode::OK, Json(json!(haiga))),
            // A parse failure must NOT become an empty list: the admin UI
            // would render an empty editor and a save would wipe the data.
            Err(e) => {
                eprintln!("Error parsing haiga.json: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Stored haiga data is invalid"})),
                )
            }
        },
        // The object not existing yet is a legitimate empty list (new site).
        Err(S3Error::NotFound) => (StatusCode::OK, Json(json!([]))),
        Err(e) => {
            eprintln!("Error fetching haiga: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to fetch haiga"})),
            )
        }
    }
}

pub async fn update_haiga_handler(
    State(state): State<AppState>,
    Json(haiga): Json<Vec<Haiga>>,
) -> (StatusCode, Json<Value>) {
    let haiga_str = serde_json::to_string(&haiga).unwrap();

    match state
        .s3_service
        .put_object("haiga.json", haiga_str.as_bytes().to_vec(), true)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"message": "Haiga list updated"})),
        ),
        Err(e) => {
            eprintln!("Error updating haiga: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update haiga"})),
            )
        }
    }
}
