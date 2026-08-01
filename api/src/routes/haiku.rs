use axum::{extract::State, http::StatusCode, response::Json};
use serde_json::{json, Value};

use crate::models::Haiku;
use crate::AppState;

pub async fn get_haiku_handler(State(state): State<AppState>) -> Json<Value> {
    match state.s3_service.get_object("haiku.json").await {
        Ok(data) => {
            let haiku_str = String::from_utf8(data).unwrap_or_default();
            let haiku: Vec<Haiku> = serde_json::from_str(&haiku_str).unwrap_or_default();
            Json(json!(haiku))
        }
        Err(e) => {
            eprintln!("Error fetching haiku: {}", e);
            Json(json!([]))
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
