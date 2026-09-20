//! Tests for the local development auth bypass (#266).
//!
//! The bypass is gated twice: by the `dev-auth` cargo feature (whether the
//! code exists at all) and by `KARI_DEV_AUTH=1` (whether the compiled-in
//! code does anything). This binary is compiled in BOTH configurations and
//! asserts the matching half of the contract in each, so `cargo test` alone
//! already proves the deployed feature set rejects the dev token.
//!
//! Everything here drives the REAL `auth_middleware` through a real
//! `AppState`, exactly as `auth_tests.rs` does.
//!
//! The environment-reading cases live in this binary only, and inside a
//! single sequential test function: `std::env::set_var` is process-global
//! and `cargo test` runs a binary's tests on parallel threads.

mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    routing::get,
    Router,
};
use common::{build_jwks, test_state};
use kari_website_api::middleware::auth::{auth_middleware, DevAuth};
use kari_website_api::AppState;
use tower::ServiceExt; // for `oneshot`

/// The dev token as an outside caller would send it. Written out rather
/// than imported from the crate on purpose: the constant does not exist in
/// a default-features build, and the point of
/// [`dev_token_is_rejected_by_a_default_state`] is what happens to this
/// exact string when it is not compiled in.
const DEV_TOKEN_LITERAL: &str = "kari-dev-auth-token";

/// A router whose single protected route is guarded by the production
/// middleware, with the given state.
fn protected_app(state: AppState) -> Router {
    Router::new()
        .route("/protected", get(|| async { "protected data" }))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
}

async fn call(app: Router, auth_header: &str) -> StatusCode {
    let response = app
        .oneshot(
            Request::builder()
                .uri("/protected")
                .header(header::AUTHORIZATION, auth_header)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    response.status()
}

/// The release proof, compiled in every configuration: a state that was not
/// told to accept dev auth never does. Run under default features (what
/// `cross build --release` ships), this is the assertion that the deployed
/// binary rejects the dev token.
#[tokio::test]
async fn dev_token_is_rejected_by_a_default_state() {
    let state = test_state(build_jwks());
    let status = call(protected_app(state), &format!("Bearer {DEV_TOKEN_LITERAL}")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// Without the feature the environment gate is not even consulted, so a host
/// with `KARI_DEV_AUTH=1` set (a developer's shell, say) gains nothing from a
/// binary built the way the deploy workflow builds it.
#[cfg(not(feature = "dev-auth"))]
#[tokio::test]
async fn from_env_is_inert_without_the_feature() {
    std::env::set_var("KARI_DEV_AUTH", "1");
    let dev_auth = DevAuth::from_env();
    std::env::remove_var("KARI_DEV_AUTH");

    assert!(!dev_auth.is_enabled());
    assert!(!dev_auth.accepts(DEV_TOKEN_LITERAL));

    let mut state = test_state(build_jwks());
    state.dev_auth = dev_auth;
    let status = call(protected_app(state), &format!("Bearer {DEV_TOKEN_LITERAL}")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[cfg(feature = "dev-auth")]
mod with_feature {
    use super::*;
    use common::{signed_token, TokenOptions};
    use kari_website_api::middleware::auth::DEV_AUTH_TOKEN;

    /// A state with dev auth switched on, as `scripts/dev.sh` runs it.
    fn dev_auth_state() -> AppState {
        let mut state = test_state(build_jwks());
        state.dev_auth = DevAuth::enabled();
        state
    }

    #[tokio::test]
    async fn enabled_dev_auth_accepts_the_exact_token() {
        assert_eq!(DEV_AUTH_TOKEN, DEV_TOKEN_LITERAL);
        let status = call(
            protected_app(dev_auth_state()),
            &format!("Bearer {DEV_AUTH_TOKEN}"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn enabled_dev_auth_rejects_any_other_bearer() {
        for token in [
            // A near miss: the comparison is exact, not a prefix match.
            "kari-dev-auth-tokens",
            "",
            "not.a.jwt",
        ] {
            let status = call(protected_app(dev_auth_state()), &format!("Bearer {token}")).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "token {token:?}");
        }
    }

    /// Dev auth is additive: real Auth0 tokens keep working beside it, which
    /// is what lets the credential-gated e2e login smoke run against the
    /// same stack.
    #[tokio::test]
    async fn enabled_dev_auth_still_accepts_a_real_jwt() {
        let token = signed_token(TokenOptions::default());
        let status = call(protected_app(dev_auth_state()), &format!("Bearer {token}")).await;
        assert_eq!(status, StatusCode::OK);
    }

    /// Feature compiled in, environment gate off: still no bypass.
    #[tokio::test]
    async fn disabled_dev_auth_rejects_the_token_even_with_the_feature() {
        let mut state = test_state(build_jwks());
        state.dev_auth = DevAuth::default();
        let status = call(protected_app(state), &format!("Bearer {DEV_AUTH_TOKEN}")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    /// One test function, run sequentially: `set_var` is process-global.
    #[test]
    fn from_env_honours_only_kari_dev_auth_equal_to_1() {
        let restore = std::env::var("KARI_DEV_AUTH").ok();

        std::env::remove_var("KARI_DEV_AUTH");
        assert!(!DevAuth::from_env().is_enabled(), "unset");

        std::env::set_var("KARI_DEV_AUTH", "1");
        assert!(DevAuth::from_env().is_enabled(), "1");
        assert!(DevAuth::from_env().accepts(DEV_AUTH_TOKEN));

        for off in ["true", "0", "", "yes", " 1"] {
            std::env::set_var("KARI_DEV_AUTH", off);
            assert!(!DevAuth::from_env().is_enabled(), "{off:?}");
            assert!(!DevAuth::from_env().accepts(DEV_AUTH_TOKEN), "{off:?}");
        }

        match restore {
            Some(value) => std::env::set_var("KARI_DEV_AUTH", value),
            None => std::env::remove_var("KARI_DEV_AUTH"),
        }
    }
}
