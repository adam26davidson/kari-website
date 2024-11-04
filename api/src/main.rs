use aws_sdk_s3::{primitives::ByteStream, Client};
use aws_smithy_types::body::SdkBody;
use axum::extract::DefaultBodyLimit;
use axum::response::Json;
use axum::{
    extract::{Multipart, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Router,
};

use futures::{StreamExt, TryStreamExt};
use hyper::body::Body;
use jsonwebtoken::{
    decode, decode_header,
    jwk::{AlgorithmParameters, JwkSet},
    Algorithm, DecodingKey, Validation,
};
use mime_guess;
use reqwest;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::error::Error;
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_util::io::StreamReader;
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
        .route("/images", post(upload_image_handler))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024 /* 10mb */))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let public_routes = Router::new()
        .route("/haiku", get(get_haiku_handler))
        .route("/haiga", get(get_haiga_handler))
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

    //print response status
    println!("Response status: {:?}", response);

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
    // Get the next field (assuming only one file being uploaded)
    if let Some(field) = match multipart.next_field().await {
        Ok(field) => field,
        Err(e) => {
            eprintln!("Error reading field: {}", e);
            return (StatusCode::BAD_REQUEST, "Error reading multipart field").into_response();
        }
    } {
        let file_name = field
            .file_name()
            .map(|name| name.to_string())
            .unwrap_or_else(|| "upload_file".to_string());
        let content_type = field
            .content_type()
            .map(|ct| ct.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());

        // Construct the key for the S3 bucket
        let key = format!("images/{}", file_name);

        // Map the field's errors into std::io::Error
        let stream = field.map_err(|err| io::Error::new(io::ErrorKind::Other, err));

        // Create a hyper::Body from the stream
        let hyper_body = Body::wrap_stream(stream);

        // Create an SdkBody from the hyper::Body
        let sdk_body = SdkBody::from(hyper_body);

        // Create a ByteStream from the SdkBody
        let byte_stream = ByteStream::new(sdk_body);

        // Upload the file to S3
        let res = state
            .s3_client
            .put_object()
            .bucket("karidavidson.com")
            .key(&key)
            .body(byte_stream)
            .content_type(content_type)
            .send()
            .await;

        match res {
            Ok(_) => println!("File uploaded successfully: {}", file_name),
            Err(e) => {
                eprintln!("Error uploading file: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Error uploading file to S3",
                )
                    .into_response();
            }
        }
    } else {
        return (StatusCode::BAD_REQUEST, "No file found in the request").into_response();
    }

    Json(json!({"message": "File uploaded successfully"}))
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
