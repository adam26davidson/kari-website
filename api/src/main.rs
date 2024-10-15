use std::net::SocketAddr;

use axum::{
    http::StatusCode,
    extract::{Request, State},
    middleware::{self, Next}, 
    response::{IntoResponse, Response},
    routing::get, 
    Router
};
use reqwest;
use axum::response::Json;
use serde_json::{json, Value};
use serde::{Serialize, Deserialize};
use tower_http::cors::CorsLayer;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation, jwk::{AlgorithmParameters, JwkSet}};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Serialize, Deserialize)]
struct Haiku {
    id: i32,
    title: String,
    lines: Vec<String>,
    publisher: String,
}

#[derive(Clone)]
struct AppState {
    jwks: Arc<RwLock<JwkSet>>,
}

#[tokio::main]
async fn main() {
    // Fetch JWKS and store in shared state
    let jwks = fetch_jwks().await.expect("Failed to fetch JWKS");
    let state = AppState {
        jwks: Arc::new(RwLock::new(jwks)),
    };

    let app = Router::new()
        .route("/haikus", get(haikus_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(), 
            auth_middleware))
        .layer(CorsLayer::permissive())
        .with_state(state);


    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn haikus_handler() -> Json<Value> {
    let haikus = vec![
        Haiku {
            id: 1,
            title: "Empty Pea Pods".to_string(),
            lines: vec!["what's left".to_string(), "of the afternoon".to_string(), "empty pea pods".to_string()],
            publisher: "placeholder publisher 1".to_string()
        }, Haiku {
            id: 2,
            title: "a child’s breath".to_string(),
            lines: vec!["first cherry blossoms".to_string(), "a child’s breath".to_string(), "on the windowpane".to_string()],
            publisher: "placeholder publisher 2".to_string()
        }, Haiku {
            id: 3,
            title: "drifting cherry petals".to_string(),
            lines: vec!["drifting cherry petals".to_string(), "for a moment".to_string(), "we let down our masks".to_string()],
            publisher: "placeholder publisher 3".to_string()
        }
    ];

    Json(json!(haikus))
}

async fn auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    // Extract the token from the Authorization header
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok());


    if let Some(auth_header) = auth_header {
        println!("Auth Header: {}", auth_header);

        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            // log the token (for dev only)
            println!("Token: {}", token);
            let token_valid = validate_token(token, &state).await.is_ok();
            if token_valid {
                return next.run(request).await;
            }
        }
    } 

    return StatusCode::UNAUTHORIZED.into_response();
}

async fn validate_token(
    token: &str,
    state: &AppState,
) -> Result<Claims, Box<dyn std::error::Error>> {
    let header = decode_header(token)?;
    let kid = header.kid.ok_or("Missing 'kid' in token header")?;

    // create a decoding key from the JWKS
    let jwks = state.jwks.read().await;
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

#[derive(Debug, Deserialize)]
struct Claims {
    // sub: String,
    // Include other fields as needed
}

// Fetch JWKS from Auth0
async fn fetch_jwks() -> Result<JwkSet, Box<dyn std::error::Error>> {
    let jwks_url = "https://dev-ivkddn8ec0pdwd5a.us.auth0.com/.well-known/jwks.json";
    let jwks: JwkSet = reqwest::get(jwks_url).await?.json().await?;
    Ok(jwks)
}
