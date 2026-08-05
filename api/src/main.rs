// The binary drives the same library crate the integration tests exercise, so
// `AppState`, the router, and the middleware are defined once and tests cover
// exactly what ships (rather than a second, separately-compiled copy).
use aws_sdk_s3::Client;
use kari_website_api::middleware::auth::{fetch_jwks, JwksCache, AUTH0_JWKS_URL};
use kari_website_api::routes::create_router;
use kari_website_api::routes::health::HealthCache;
use kari_website_api::services::object_store::ObjectStore;
use kari_website_api::services::s3::S3Service;
use kari_website_api::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    // Load environment variables
    dotenv::dotenv().ok();

    // Structured request/error logging (RUST_LOG overrides the default)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Initialize AWS SDK. aws-config picks up AWS_ENDPOINT_URL from the
    // environment, which the e2e stack uses to point at a local MinIO; a
    // custom endpoint also needs path-style addressing, since
    // virtual-host-style would resolve "<bucket>.localhost".
    let sdk_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let mut s3_config = aws_sdk_s3::config::Builder::from(&sdk_config);
    if std::env::var("AWS_ENDPOINT_URL").is_ok() {
        s3_config = s3_config.force_path_style(true);
    }
    let s3_client = Client::from_conf(s3_config.build());

    // Get bucket name from environment
    let bucket_name = std::env::var("BUCKET_NAME").expect("BUCKET_NAME not set");

    // Create S3 service
    let s3_service: Arc<dyn ObjectStore> = Arc::new(S3Service::new(s3_client, bucket_name));

    // Fetch JWKS and store in shared state
    let jwks = fetch_jwks(AUTH0_JWKS_URL)
        .await
        .expect("Failed to fetch JWKS");

    // Create application state
    let state = AppState {
        jwks: Arc::new(JwksCache::new(jwks, AUTH0_JWKS_URL.to_string())),
        s3_service,
        health: Arc::new(HealthCache::default()),
    };

    // Create router with routes
    let app = create_router(state).layer(CorsLayer::permissive());

    // Get port from environment or use default
    let port = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(3000);

    // Start the server
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
