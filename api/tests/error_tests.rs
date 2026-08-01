//! Tests for the central `AppError` → HTTP response mapping.

use axum::http::StatusCode;
use axum::response::IntoResponse;
use kari_website_api::error::AppError;

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn not_found_maps_to_404_with_error_body() {
    let response = AppError::NotFound("Image not found").into_response();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        body_json(response).await,
        serde_json::json!({"error": "Image not found"})
    );
}

#[tokio::test]
async fn bad_request_maps_to_400() {
    let response = AppError::BadRequest("No file found").into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn internal_maps_to_500_and_hides_the_cause() {
    // The underlying cause is logged, not sent to the client.
    let response =
        AppError::internal("Failed to update haiku", "AccessDenied: ...").into_response();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body_json(response).await,
        serde_json::json!({"error": "Failed to update haiku"})
    );
}
