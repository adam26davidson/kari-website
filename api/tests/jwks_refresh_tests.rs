//! Tests for the JWKS refresh path of the REAL `middleware/auth.rs`: a token
//! naming an unknown key id triggers a rate-limited re-fetch of the JWKS
//! (Auth0 key rotation), served here by a local HTTP endpoint that counts
//! requests, so the fetch/cooldown behavior is asserted hermetically.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    routing::get,
    Router,
};
use common::{
    build_jwks, build_jwks_with_kid, capture_tracing, signed_token, test_state_with_jwks_url,
    TokenOptions,
};
use jsonwebtoken::jwk::JwkSet;
use kari_website_api::middleware::auth::auth_middleware;
use tower::ServiceExt; // for `oneshot`

/// The key id Auth0 "rotated to": tokens are signed with the test private
/// key but name this kid, which the initial JWKS does not contain.
const ROTATED_KID: &str = "rotated-key-1";

/// Serve `body` with `status` at a local JWKS URL on an OS-assigned port,
/// counting how many times the endpoint is actually fetched.
async fn spawn_jwks_endpoint(status: StatusCode, body: String) -> (String, Arc<AtomicUsize>) {
    let fetches = Arc::new(AtomicUsize::new(0));
    let handler_fetches = fetches.clone();
    let app = Router::new().route(
        "/jwks.json",
        get(move || {
            let fetches = handler_fetches.clone();
            let body = body.clone();
            async move {
                fetches.fetch_add(1, Ordering::SeqCst);
                (status, [(header::CONTENT_TYPE, "application/json")], body)
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind local jwks endpoint");
    let addr = listener.local_addr().expect("local addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve jwks");
    });
    (format!("http://{addr}/jwks.json"), fetches)
}

/// A router whose protected route is guarded by the production middleware,
/// with the JWKS cache initialized from `initial` and refreshing from `url`.
fn protected_app(initial: JwkSet, url: &str) -> Router {
    let state = test_state_with_jwks_url(initial, url.to_string());
    Router::new()
        .route("/protected", get(|| async { "protected data" }))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
}

async fn call(app: Router, token: &str) -> StatusCode {
    let request = Request::builder()
        .uri("/protected")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    app.oneshot(request).await.unwrap().status()
}

#[tokio::test]
async fn rotated_key_token_validates_after_jwks_refresh() {
    let _trace = capture_tracing();
    // The endpoint already serves the rotated JWKS; the cache still holds the
    // old one, so the first sight of the rotated kid must trigger a re-fetch.
    let rotated_jwks = serde_json::to_string(&build_jwks_with_kid(ROTATED_KID)).unwrap();
    let (url, fetches) = spawn_jwks_endpoint(StatusCode::OK, rotated_jwks).await;
    let app = protected_app(build_jwks(), &url);
    let token = signed_token(TokenOptions {
        kid: ROTATED_KID.to_string(),
        ..Default::default()
    });

    assert_eq!(call(app.clone(), &token).await, StatusCode::OK);
    assert_eq!(fetches.load(Ordering::SeqCst), 1);

    // The refreshed keys are cached: the same token validates again without
    // another fetch.
    assert_eq!(call(app, &token).await, StatusCode::OK);
    assert_eq!(fetches.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn second_unknown_kid_within_cooldown_does_not_refetch() {
    // The endpoint serves a JWKS that still lacks the unknown kid: the first
    // request refreshes (one fetch) but stays unauthorized; the second lands
    // inside the refresh cooldown and must not fetch again.
    let unchanged_jwks = serde_json::to_string(&build_jwks()).unwrap();
    let (url, fetches) = spawn_jwks_endpoint(StatusCode::OK, unchanged_jwks).await;
    let app = protected_app(build_jwks(), &url);

    let first = signed_token(TokenOptions {
        kid: "unknown-kid-a".to_string(),
        ..Default::default()
    });
    assert_eq!(call(app.clone(), &first).await, StatusCode::UNAUTHORIZED);
    assert_eq!(fetches.load(Ordering::SeqCst), 1);

    let second = signed_token(TokenOptions {
        kid: "unknown-kid-b".to_string(),
        ..Default::default()
    });
    assert_eq!(call(app, &second).await, StatusCode::UNAUTHORIZED);
    assert_eq!(
        fetches.load(Ordering::SeqCst),
        1,
        "an unknown kid within the cooldown must not re-fetch the JWKS"
    );
}

#[tokio::test]
async fn failing_jwks_endpoint_rejects_token_and_is_rate_limited() {
    let _trace = capture_tracing();
    // The endpoint is up but broken (500, non-JSON body): the refresh fails,
    // the request is rejected, and — because the cooldown stamp is written
    // BEFORE fetching — the failure is rate-limited like a success.
    let (url, fetches) = spawn_jwks_endpoint(
        StatusCode::INTERNAL_SERVER_ERROR,
        "server error".to_string(),
    )
    .await;
    let app = protected_app(build_jwks(), &url);
    let token = signed_token(TokenOptions {
        kid: ROTATED_KID.to_string(),
        ..Default::default()
    });

    assert_eq!(call(app.clone(), &token).await, StatusCode::UNAUTHORIZED);
    assert_eq!(fetches.load(Ordering::SeqCst), 1);

    assert_eq!(call(app, &token).await, StatusCode::UNAUTHORIZED);
    assert_eq!(
        fetches.load(Ordering::SeqCst),
        1,
        "a failed refresh must also start the cooldown (stamp-before-fetch)"
    );
}

#[tokio::test]
async fn non_rsa_key_matching_the_kid_is_rejected() {
    // A JWKS entry can match the token's kid but not be an RSA key at all;
    // validation must reject it outright rather than attempt a refresh.
    let symmetric_jwks: JwkSet = serde_json::from_value(serde_json::json!({
        "keys": [{
            "kty": "oct",
            "alg": "HS256",
            "kid": "symmetric-key",
            "k": "c2VjcmV0LWJ5dGVz",
        }]
    }))
    .expect("symmetric JWKS should deserialize");
    // Unroutable refresh URL: an unexpected refresh attempt would fail fast.
    let app = protected_app(symmetric_jwks, "http://127.0.0.1:1/jwks.json");
    let token = signed_token(TokenOptions {
        kid: "symmetric-key".to_string(),
        ..Default::default()
    });

    assert_eq!(call(app, &token).await, StatusCode::UNAUTHORIZED);
}
