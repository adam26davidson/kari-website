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
use aws_sdk_s3::{primitives::ByteStream, Client};


#[derive(Serialize, Deserialize)]
struct Haiku {
    title: String,
    lines: Vec<String>,
    publisher: String,
}

#[derive(Clone)]
struct AppState {
    jwks: Arc<RwLock<JwkSet>>,
    s3_client: Client,
}

#[tokio::main]
async fn main() {
    // Initialize S3 client
    let sdk_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let client = Client::new(&sdk_config);

    // Fetch JWKS and store in shared state
    let jwks = fetch_jwks().await.expect("Failed to fetch JWKS");
    let state = AppState {
        jwks: Arc::new(RwLock::new(jwks)),
        s3_client: client,
    };

    let app = Router::new()
        .route("/haiku", get(get_haikus_handler))
        .route("/haiku", axum::routing::put(update_haikus_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(), 
            auth_middleware))
        .layer(CorsLayer::permissive())
        .with_state(state);


    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn get_haikus_handler(
    State(state): State<AppState>
) -> Json<Value> {
    //get haikus from S3 in bucket "karidavidson.com/haiku.json"
    let haiku_str = String::from_utf8(state.s3_client.get_object()
        .bucket("karidavidson.com")
        .key("haiku.json")
        .send().await.unwrap()
        .body.collect().await.unwrap().to_vec()).unwrap();

    let haiku: Vec<Haiku> = serde_json::from_str(&haiku_str).unwrap();

    return Json(json!(haiku));
}

async fn update_haikus_handler(
    State(state): State<AppState>,
    Json(haiku): Json<Vec<Haiku>>
) -> Json<Value> {
    //update haikus in S3 in bucket "karidavidson.com/haiku.json"
    let haiku_str = serde_json::to_string(&haiku).unwrap();
    
    state.s3_client.put_object()
        .bucket("karidavidson.com")
        .key("haiku.json")
        .body(ByteStream::from(haiku_str.as_bytes().to_vec()))
        .send().await.unwrap();

    return Json(json!({"message": "Haiku list updated"}));
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
        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            if validate_token(token, &state).await.is_ok() {
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
