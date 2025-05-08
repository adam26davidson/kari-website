use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::models::Haiga;
use crate::AppState;

pub async fn get_haiga_handler(State(state): State<AppState>) -> Json<Value> {
    match state.s3_service.get_object("haiga.json").await {
        Ok(data) => {
            let haiga_str = String::from_utf8(data).unwrap_or_default();
            let haiga: Vec<Haiga> = serde_json::from_str(&haiga_str).unwrap_or_default();
            Json(json!(haiga))
        }
        Err(e) => {
            eprintln!("Error fetching haiga: {}", e);
            Json(json!([]))
        }
    }
}

pub async fn update_haiga_handler(
    State(state): State<AppState>,
    Json(haiga): Json<Vec<Haiga>>,
) -> Json<Value> {
    let haiga_str = serde_json::to_string(&haiga).unwrap();

    match state
        .s3_service
        .put_object("haiga.json", haiga_str.as_bytes().to_vec(), true)
        .await
    {
        Ok(_) => Json(json!({"message": "Haiga list updated"})),
        Err(e) => {
            eprintln!("Error updating haiga: {}", e);
            Json(json!({"error": "Failed to update haiga"}))
        }
    }
}
