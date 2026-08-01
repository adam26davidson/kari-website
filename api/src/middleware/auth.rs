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
