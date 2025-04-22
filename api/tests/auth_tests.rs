use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use tower::ServiceExt; // for `oneshot`

// A simple test auth function
async fn validate_token(token: &str) -> bool {
    token == "valid_test_token"
}

// A simple middleware function for testing
async fn auth_middleware(request: Request<Body>) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));

    match auth_header {
        Some(token) if validate_token(token).await => Ok("Protected data".into_response()),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

// A simple Router that makes a request to a protected endpoint
fn create_test_app() -> Router {
    Router::new().route("/protected", get(auth_middleware))
}

#[tokio::test]
async fn test_valid_token() {
    let app = create_test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header(header::AUTHORIZATION, "Bearer valid_test_token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_invalid_token() {
    let app = create_test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header(header::AUTHORIZATION, "Bearer invalid_token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_missing_token() {
    let app = create_test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
