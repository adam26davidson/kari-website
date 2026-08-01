pub mod error;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;

use middleware::auth::JwksCache;
use routes::health::HealthCache;
use services::s3::S3Service;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub jwks: Arc<JwksCache>,
    pub s3_service: Arc<S3Service>,
    pub health: Arc<HealthCache>,
}
