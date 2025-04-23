use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::models::HomePageData;
use crate::AppState;

pub async fn get_home_page_handler(State(state): State<AppState>) -> Json<Value> {
    match state.s3_service.get_object("home-page.json").await {
        Ok(data) => {
            let home_page_data_str = String::from_utf8(data).unwrap_or_default();
            match serde_json::from_str::<HomePageData>(&home_page_data_str) {
                Ok(home_page_data) => Json(json!(home_page_data)),
                Err(e) => {
                    eprintln!("Error parsing home page data: {}", e);
                    Json(json!({"error": "Invalid home page data format"}))
                }
            }
        }
        Err(e) => {
            eprintln!("Error fetching home page data: {}", e);
            Json(json!({"error": "Failed to fetch home page data"}))
        }
    }
}

pub async fn update_home_page_handler(
    State(state): State<AppState>,
    Json(home_page_data): Json<HomePageData>,
) -> Json<Value> {
    let home_page_data_str = serde_json::to_string(&home_page_data).unwrap();
    
    match state.s3_service.put_object("home-page.json", home_page_data_str.as_bytes().to_vec()).await {
        Ok(_) => Json(json!({"message": "Home page data updated"})),
        Err(e) => {
            eprintln!("Error updating home page data: {}", e);
            Json(json!({"error": "Failed to update home page data"}))
        }
    }
}