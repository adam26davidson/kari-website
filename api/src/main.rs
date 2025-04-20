use aws_sdk_s3::{primitives::ByteStream, Client};
use axum::extract::DefaultBodyLimit;
use axum::response::Json;
use axum::{
    extract::{Multipart, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Router,
};

use jsonwebtoken::{
    decode, decode_header,
    jwk::{AlgorithmParameters, JwkSet},
    Algorithm, DecodingKey, Validation,
};
use mime_guess;
use reqwest;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;

#[derive(Serialize, Deserialize)]
struct Haiku {
    id: String,
    title: String,
    lines: Vec<String>,
    publisher: String,
}

#[derive(Serialize, Deserialize)]
struct Haiga {
    id: String,
    title: String,
    lines: Vec<String>,
    publisher: String,
    image: String,
}

#[derive(Serialize, Deserialize)]
struct HomePageData {
    #[serde(rename = "featuredHaiku")]
    featured_haiku: Haiku,
    blurb: String,
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

    let secure_routes = Router::new()
        .route("/haiku", put(update_haiku_handler))
        .route("/haiga", put(update_haiga_handler))
        .route("/home-page", put(update_home_page_handler))
        .route("/images", post(upload_image_handler))
        .route("/images/:filename", delete(delete_image_handler))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024 /* 10mb */))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let public_routes = Router::new()
        .route("/haiku", get(get_haiku_handler))
        .route("/haiga", get(get_haiga_handler))
        .route("/home-page", get(get_home_page_handler))
        .route("/images/:filename", get(get_image_handler));

    let app = Router::new()
        .merge(secure_routes)
        .merge(public_routes)
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn get_haiku_handler(State(state): State<AppState>) -> Json<Value> {
    //get haiku from S3 in bucket "karidavidson.com/haiku.json"
    let haiku_str = String::from_utf8(
        state
            .s3_client
            .get_object()
            .bucket("karidavidson.com")
            .key("haiku.json")
            .send()
            .await
            .unwrap()
            .body
            .collect()
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();

    let haiku: Vec<Haiku> = serde_json::from_str(&haiku_str).unwrap();

    return Json(json!(haiku));
}

async fn get_haiga_handler(State(state): State<AppState>) -> Json<Value> {
    //get haiga from S3 in bucket "karidavidson.com/haiga.json"
    let haiga_str = String::from_utf8(
        state
            .s3_client
            .get_object()
            .bucket("karidavidson.com")
            .key("haiga.json")
            .send()
            .await
            .unwrap()
            .body
            .collect()
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();

    let haiga: Vec<Haiga> = serde_json::from_str(&haiga_str).unwrap();

    return Json(json!(haiga));
}

async fn get_home_page_handler(State(state): State<AppState>) -> Json<Value> {
    //get home page data from S3 in bucket "karidavidson.com/home-page.json"
    let home_page_data_str = String::from_utf8(
        state
            .s3_client
            .get_object()
            .bucket("karidavidson.com")
            .key("home-page.json")
            .send()
            .await
            .unwrap()
            .body
            .collect()
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();

    let home_page_data: HomePageData = serde_json::from_str(&home_page_data_str).unwrap();

    return Json(json!(home_page_data));
}

async fn get_image_handler(
    State(state): State<AppState>,
    axum::extract::Path(filename): axum::extract::Path<String>,
) -> impl IntoResponse {
    // print request path
    println!("Request path: {}", filename);

    let bucket_name = "karidavidson.com";
    let image_key = format!("images/{}", filename);

    let response = state
        .s3_client
        .get_object()
        .bucket(bucket_name)
        .key(&image_key)
        .send()
        .await;

    match response {
        Ok(output) => {
            let bytes = output.body.collect().await.unwrap().to_vec();
            let content_type = mime_guess::from_path(&filename).first_or_octet_stream();
            (
                StatusCode::OK,
                [("Content-Type", content_type.as_ref())],
                bytes,
            )
                .into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Image not found").into_response(),
    }
}

async fn upload_image_handler(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // Pull out the first (and only) file field
    let mut field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        Ok(None) => return (StatusCode::BAD_REQUEST, "No file found").into_response(),
        Err(e) => {
            eprintln!("Error reading multipart field: {}", e);
            return (StatusCode::BAD_REQUEST, "Invalid multipart").into_response();
        }
    };

    // Get original filename (or fallback)
    let file_name = field
        .file_name()
        .map(|n| n.to_string())
        .unwrap_or_else(|| "upload_file".to_string());
    let key = format!("images/{}", file_name);

    // Read entire stream into a Vec<u8>
    let mut data = Vec::new();
    while let Ok(Some(chunk)) = field.chunk().await {
        data.extend_from_slice(&chunk);
    }

    // Upload in one shot
    match state
        .s3_client
        .put_object()
        .bucket("karidavidson.com")
        .key(&key)
        .body(ByteStream::from(data))
        .send()
        .await
    {
        Ok(_) => {
            println!("File uploaded successfully: {}", file_name);
            (StatusCode::OK, "File uploaded successfully").into_response()
        }
        Err(err) => {
            eprintln!("PutObject error: {:?}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, "Upload failed").into_response()
        }
    }
}

async fn delete_image_handler(
    State(state): State<AppState>,
    axum::extract::Path(filename): axum::extract::Path<String>,
) -> impl IntoResponse {
    let bucket_name = "karidavidson.com";
    let image_key = format!("images/{}", filename);

    let response = state
        .s3_client
        .delete_object()
        .bucket(bucket_name)
        .key(&image_key)
        .send()
        .await;

    match response {
        Ok(_) => (StatusCode::OK, "Image deleted successfully").into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Image not found").into_response(),
    }
}

async fn update_haiku_handler(
    State(state): State<AppState>,
    Json(haiku): Json<Vec<Haiku>>,
) -> Json<Value> {
    //update haikus in S3 in bucket "karidavidson.com/haiku.json"
    let haiku_str = serde_json::to_string(&haiku).unwrap();

    state
        .s3_client
        .put_object()
        .bucket("karidavidson.com")
        .key("haiku.json")
        .body(ByteStream::from(haiku_str.as_bytes().to_vec()))
        .send()
        .await
        .unwrap();

    return Json(json!({"message": "Haiku list updated"}));
}

async fn update_haiga_handler(
    State(state): State<AppState>,
    Json(haiga): Json<Vec<Haiga>>,
) -> Json<Value> {
    //update haikus in S3 in bucket "karidavidson.com/haiku.json"
    let haiga_str = serde_json::to_string(&haiga).unwrap();

    state
        .s3_client
        .put_object()
        .bucket("karidavidson.com")
        .key("haiga.json")
        .body(ByteStream::from(haiga_str.as_bytes().to_vec()))
        .send()
        .await
        .unwrap();

    return Json(json!({"message": "Haiku list updated"}));
}

async fn update_home_page_handler(
    State(state): State<AppState>,
    Json(home_page_data): Json<HomePageData>,
) -> Json<Value> {
    //update home page data in S3 in bucket "karidavidson.com/home-page.json"
    let home_page_data_str = serde_json::to_string(&home_page_data).unwrap();

    state
        .s3_client
        .put_object()
        .bucket("karidavidson.com")
        .key("home-page.json")
        .body(ByteStream::from(home_page_data_str.as_bytes().to_vec()))
        .send()
        .await
        .unwrap();

    return Json(json!({"message": "Home page data updated"}));
}

async fn auth_middleware(State(state): State<AppState>, request: Request, next: Next) -> Response {
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
