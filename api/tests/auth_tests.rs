//! Tests for the REAL authentication middleware in `middleware/auth.rs`.
//!
//! These build a router that wraps the production `auth_middleware` with a real
//! `AppState`, then drive it with tokens signed by a test keypair whose public
//! half lives in the state's JWKS. This exercises the actual JWKS lookup and
//! JWT validation logic rather than a parallel re-implementation.

mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    routing::get,
    Router,
};
use common::{signed_token, test_state, TokenOptions};
use kari_website_api::middleware::auth::auth_middleware;
use tower::ServiceExt; // for `oneshot`

/// A router whose single protected route is guarded by the production middleware.
fn protected_app() -> Router {
    let state = test_state(common::build_jwks());
    Router::new()
        .route("/protected", get(|| async { "protected data" }))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
}

async fn call(app: Router, auth_header: Option<&str>) -> StatusCode {
    let mut builder = Request::builder().uri("/protected");
    if let Some(value) = auth_header {
        builder = builder.header(header::AUTHORIZATION, value);
    }
    let response = app
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap();
    response.status()
}

#[tokio::test]
async fn valid_token_is_authorized() {
    let token = signed_token(TokenOptions::default());
    let status = call(protected_app(), Some(&format!("Bearer {token}"))).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn missing_authorization_header_is_rejected() {
    let status = call(protected_app(), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn non_bearer_scheme_is_rejected() {
    let token = signed_token(TokenOptions::default());
    let status = call(protected_app(), Some(&format!("Basic {token}"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn garbage_token_is_rejected() {
    let status = call(protected_app(), Some("Bearer not-a-real-jwt")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unknown_key_id_is_rejected() {
    let token = signed_token(TokenOptions {
        kid: "some-other-kid".to_string(),
        ..Default::default()
    });
    let status = call(protected_app(), Some(&format!("Bearer {token}"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn expired_token_is_rejected() {
    let token = signed_token(TokenOptions {
        // Well beyond jsonwebtoken's default 60s validation leeway.
        expires_in_secs: -3600,
        ..Default::default()
    });
    let status = call(protected_app(), Some(&format!("Bearer {token}"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn wrong_audience_is_rejected() {
    let token = signed_token(TokenOptions {
        audience: "https://someone-elses-api.example.com/".to_string(),
        ..Default::default()
    });
    let status = call(protected_app(), Some(&format!("Bearer {token}"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn wrong_issuer_is_rejected() {
    let token = signed_token(TokenOptions {
        issuer: "https://evil.example.com/".to_string(),
        ..Default::default()
    });
    let status = call(protected_app(), Some(&format!("Bearer {token}"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
