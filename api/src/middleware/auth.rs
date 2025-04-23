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
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct Claims {
    // Add required claims here
}

pub async fn auth_middleware(State(state): State<AppState>, request: Request, next: Next) -> Response {
    // Extract the token from the Authorization header
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok());

    if let Some(auth_header) = auth_header {
        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            if validate_token(token, &state.jwks).await.is_ok() {
                return next.run(request).await;
            }
        }
    }

    StatusCode::UNAUTHORIZED.into_response()
}

async fn validate_token(
    token: &str,
    jwks: &Arc<RwLock<JwkSet>>,
) -> Result<Claims, Box<dyn std::error::Error>> {
    let header = decode_header(token)?;
    let kid = header.kid.ok_or("Missing 'kid' in token header")?;

    // create a decoding key from the JWKS
    let jwks = jwks.read().await;
    let jwk = jwks.find(&kid).ok_or("Key ID not found in JWKS")?;
    let decoding_key = match &jwk.algorithm {
        AlgorithmParameters::RSA(ref rsa) => {
            let key = DecodingKey::from_rsa_components(&rsa.n, &rsa.e)?;
            key
        }
        _ => return Err("Unsupported key type".into()),
    };

    // validation object determines what claims to validate
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&["https://api.karidavidson.com/"]);
    validation.set_issuer(&["https://dev-ivkddn8ec0pdwd5a.us.auth0.com/"]);

    let token_data = decode::<Claims>(token, &decoding_key, &validation)?;
    Ok(token_data.claims)
}

// Fetch JWKS from Auth0
pub async fn fetch_jwks() -> Result<JwkSet, Box<dyn std::error::Error>> {
    let jwks_url = "https://dev-ivkddn8ec0pdwd5a.us.auth0.com/.well-known/jwks.json";
    let jwks: JwkSet = reqwest::get(jwks_url).await?.json().await?;
    Ok(jwks)
}