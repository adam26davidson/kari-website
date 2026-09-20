use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{
    decode, decode_header,
    jwk::{AlgorithmParameters, JwkSet},
    Algorithm, DecodingKey, Validation,
};
use serde::Deserialize;
use tokio::sync::{Mutex, RwLock};

use crate::AppState;

pub const AUTH0_JWKS_URL: &str = "https://dev-ivkddn8ec0pdwd5a.us.auth0.com/.well-known/jwks.json";

/// Auth0 rotates signing keys; don't hammer the JWKS endpoint when a flood of
/// tokens with unknown key ids arrives.
const JWKS_REFRESH_COOLDOWN: Duration = Duration::from_secs(60);

/// The static bearer token the local development stack accepts as an admin
/// (#266).
///
/// Deliberately public and deliberately not a secret: it exists so a
/// developer, an agent or a CI job can drive the admin UI without an Auth0
/// round trip. Its safety comes from ABSENCE, not from obscurity — this
/// constant is compiled only under the `dev-auth` cargo feature, which no
/// deployed build enables, so the string is not in the shipped binary at
/// all (CI greps the default-features binary to prove it).
#[cfg(feature = "dev-auth")]
pub const DEV_AUTH_TOKEN: &str = "kari-dev-auth-token";

/// Whether this process accepts [`DEV_AUTH_TOKEN`] as an admin credential.
///
/// Two independent gates, on purpose:
///
/// 1. the `dev-auth` cargo feature, which decides whether the code exists;
/// 2. `KARI_DEV_AUTH=1` in the environment, which decides whether the
///    compiled-in code does anything.
///
/// The value lives in [`crate::AppState`] rather than being read from the
/// environment at the point of use, because configuration in this crate is
/// injected, never ambient — that is what keeps the test suite parallel-safe.
///
/// Dev auth is strictly ADDITIVE: a real Auth0 JWT is validated exactly as
/// before in every configuration.
#[derive(Clone, Copy, Debug, Default)]
pub struct DevAuth {
    #[cfg(feature = "dev-auth")]
    enabled: bool,
}

impl DevAuth {
    /// Read the environment gate. Only the exact string `1` turns dev auth
    /// on; with the feature compiled out this is inert whatever the
    /// environment says.
    #[cfg(feature = "dev-auth")]
    pub fn from_env() -> Self {
        Self {
            enabled: std::env::var("KARI_DEV_AUTH").as_deref() == Ok("1"),
        }
    }

    /// Without the `dev-auth` feature there is nothing to enable, so the
    /// environment is not even consulted.
    #[cfg(not(feature = "dev-auth"))]
    pub fn from_env() -> Self {
        Self::default()
    }

    /// Dev auth on, for tests and callers that configure it directly.
    #[cfg(feature = "dev-auth")]
    pub const fn enabled() -> Self {
        Self { enabled: true }
    }

    /// Whether the dev token is currently accepted (worth saying out loud at
    /// startup — see `main.rs`).
    #[cfg(feature = "dev-auth")]
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Always false in a build without the feature.
    #[cfg(not(feature = "dev-auth"))]
    pub fn is_enabled(&self) -> bool {
        false
    }

    /// Whether `token` is the dev token AND dev auth is on.
    #[cfg(feature = "dev-auth")]
    pub fn accepts(&self, token: &str) -> bool {
        self.enabled && token == DEV_AUTH_TOKEN
    }

    /// Without the feature there is no dev token to compare against — the
    /// comparison, and the token string itself, are not compiled.
    #[cfg(not(feature = "dev-auth"))]
    pub fn accepts(&self, _token: &str) -> bool {
        false
    }
}

#[derive(Debug, Deserialize)]
pub struct Claims {
    // Add required claims here
}

/// The JWKS plus the machinery to re-fetch it when Auth0 rotates keys.
pub struct JwksCache {
    keys: RwLock<JwkSet>,
    jwks_url: String,
    refreshed_at: Mutex<Option<Instant>>,
}

impl JwksCache {
    pub fn new(keys: JwkSet, jwks_url: String) -> Self {
        Self {
            keys: RwLock::new(keys),
            jwks_url,
            refreshed_at: Mutex::new(None),
        }
    }

    /// Re-fetch the JWKS, rate-limited by [`JWKS_REFRESH_COOLDOWN`]. Returns
    /// whether a refresh actually ran and succeeded.
    async fn refresh(&self) -> bool {
        let mut refreshed_at = self.refreshed_at.lock().await;
        if let Some(at) = *refreshed_at {
            if at.elapsed() < JWKS_REFRESH_COOLDOWN {
                return false;
            }
        }
        // Stamp before fetching so a failing endpoint is also rate-limited.
        *refreshed_at = Some(Instant::now());
        match fetch_jwks(&self.jwks_url).await {
            Ok(new_keys) => {
                *self.keys.write().await = new_keys;
                tracing::info!("JWKS refreshed after unknown key id");
                true
            }
            Err(e) => {
                tracing::error!("Failed to refresh JWKS: {e}");
                false
            }
        }
    }
}

enum AuthError {
    /// The token names a key id we don't have — possibly a rotated key.
    UnknownKid,
    /// Anything else wrong with the token; never worth a JWKS refresh.
    Invalid,
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok());

    if let Some(token) = auth_header.and_then(|h| h.strip_prefix("Bearer ")) {
        // The local development bypass (#266). Checked before the real
        // validation and never instead of it: an Auth0 JWT still takes the
        // path below in every build. `accepts` is a hard `false` unless the
        // `dev-auth` feature was compiled in AND KARI_DEV_AUTH=1 was set.
        if state.dev_auth.accepts(token) {
            return next.run(request).await;
        }
        match validate_token(token, &state.jwks).await {
            Ok(_) => return next.run(request).await,
            // Auth0 may have rotated its signing keys since we fetched the
            // JWKS: refresh (rate-limited) and retry once.
            Err(AuthError::UnknownKid) => {
                if state.jwks.refresh().await && validate_token(token, &state.jwks).await.is_ok() {
                    return next.run(request).await;
                }
            }
            Err(AuthError::Invalid) => {}
        }
    }

    StatusCode::UNAUTHORIZED.into_response()
}

async fn validate_token(token: &str, jwks: &JwksCache) -> Result<Claims, AuthError> {
    let header = decode_header(token).map_err(|_| AuthError::Invalid)?;
    let kid = header.kid.ok_or(AuthError::Invalid)?;

    // create a decoding key from the JWKS
    let keys = jwks.keys.read().await;
    let jwk = keys.find(&kid).ok_or(AuthError::UnknownKid)?;
    let decoding_key = match &jwk.algorithm {
        AlgorithmParameters::RSA(ref rsa) => {
            DecodingKey::from_rsa_components(&rsa.n, &rsa.e).map_err(|_| AuthError::Invalid)?
        }
        _ => return Err(AuthError::Invalid),
    };

    // validation object determines what claims to validate
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&["https://api.karidavidson.com/"]);
    validation.set_issuer(&["https://dev-ivkddn8ec0pdwd5a.us.auth0.com/"]);

    let token_data =
        decode::<Claims>(token, &decoding_key, &validation).map_err(|_| AuthError::Invalid)?;
    Ok(token_data.claims)
}

// Fetch JWKS from the identity provider
pub async fn fetch_jwks(
    jwks_url: &str,
) -> Result<JwkSet, Box<dyn std::error::Error + Send + Sync>> {
    let jwks: JwkSet = reqwest::get(jwks_url).await?.json().await?;
    Ok(jwks)
}
