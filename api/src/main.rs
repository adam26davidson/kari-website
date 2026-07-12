mod middleware;
mod models;
mod routes;
mod services;

use aws_sdk_s3::Client;
use jsonwebtoken::jwk::JwkSet;
use services::s3::S3Service;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct AppState {
    jwks: Arc<RwLock<JwkSet>>,
    s3_client: Client,
    bucket_name: String,
    s3_service: Arc<S3Service>,
}

#[tokio::main]
async fn main() {
    // Load environment variables
    dotenv::dotenv().ok();

    // Initialize AWS SDK
    let sdk_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let s3_client = Client::new(&sdk_config);

    // Get bucket name from environment
    let bucket_name = std::env::var("BUCKET_NAME").expect("BUCKET_NAME not set");

    // Create S3 service
    let s3_service = Arc::new(S3Service::new(s3_client.clone(), bucket_name.clone()));

    // Fetch JWKS and store in shared state
    let jwks = middleware::auth::fetch_jwks()
        .await
        .expect("Failed to fetch JWKS");

    // Create application state
    let state = AppState {
        jwks: Arc::new(RwLock::new(jwks)),
        s3_client,
        bucket_name,
        s3_service,
    };

    // Create router with routes
    let app = routes::create_router(state).layer(CorsLayer::permissive());

    // Get port from environment or use default
    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(3000);

    // Start the server
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
