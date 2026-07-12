//! Tests for the REAL router assembled by `routes::create_router`.
//!
//! These verify that the secure/public split and the auth layer are wired up
//! correctly. Requests to secure routes without a valid token must be rejected
//! before any handler (and therefore any S3 call) runs, so a dummy S3 client in
//! the state is never actually exercised here.

mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use common::{signed_token, test_state, TokenOptions};
use kari_website_api::routes::create_router;
use tower::ServiceExt;

fn app() -> axum::Router {
    create_router(test_state(common::build_jwks()))
}

async fn status_of(req: Request<Body>) -> StatusCode {
    app().oneshot(req).await.unwrap().status()
}

#[tokio::test]
async fn secure_route_without_token_is_unauthorized() {
    let req = Request::builder()
        .method("PUT")
        .uri("/haiku")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("[]"))
        .unwrap();
    assert_eq!(status_of(req).await, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn secure_route_with_invalid_token_is_unauthorized() {
    let req = Request::builder()
        .method("PUT")
        .uri("/blog")
        .header(header::AUTHORIZATION, "Bearer garbage")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("[]"))
        .unwrap();
    assert_eq!(status_of(req).await, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn secure_route_with_valid_token_passes_auth() {
    // With a valid token the request clears the auth layer and reaches the
    // handler. The handler then tries to use the dummy S3 client, which fails,
    // so we only assert that the response is NOT 401 (auth succeeded).
    let token = signed_token(TokenOptions::default());
    let req = Request::builder()
        .method("PUT")
        .uri("/haiku")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("[]"))
        .unwrap();
    assert_ne!(status_of(req).await, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unknown_route_is_not_found() {
    let req = Request::builder()
        .uri("/definitely-not-a-route")
        .body(Body::empty())
        .unwrap();
    assert_eq!(status_of(req).await, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn public_route_does_not_require_auth() {
    // The home-page GET is public: it should never return 401 even without a
    // token (it may fail later against the dummy S3 client, which is fine).
    let req = Request::builder()
        .uri("/home-page")
        .body(Body::empty())
        .unwrap();
    assert_ne!(status_of(req).await, StatusCode::UNAUTHORIZED);
}
