use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::models::PhotographyPost;
use crate::AppState;

pub async fn get_photography_handler(State(state): State<AppState>) -> Json<Value> {
    match state.s3_service.get_object("photography.json").await {
        Ok(data) => {
            let data_str = String::from_utf8(data).unwrap_or_default();
            let posts: Vec<PhotographyPost> = serde_json::from_str(&data_str).unwrap_or_default();
            Json(json!(posts))
        }
        Err(e) => {
            eprintln!("Error fetching photography: {}", e);
            Json(json!({"error": "Failed to fetch photography"}))
        }
    }
}

pub async fn update_photography_handler(
    State(state): State<AppState>,
    Json(posts): Json<Vec<PhotographyPost>>,
) -> Json<Value> {
    let posts_str = serde_json::to_string(&posts).unwrap();

    match state
        .s3_service
        .put_object("photography.json", posts_str.as_bytes().to_vec(), true)
        .await
    {
        Ok(_) => Json(json!({"message": "Photography posts updated"})),
        Err(e) => {
            eprintln!("Error updating photography: {}", e);
            Json(json!({"error": "Failed to update photography posts"}))
        }
    }
}
