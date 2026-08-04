pub mod error;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;

use middleware::auth::JwksCache;
use routes::health::HealthCache;
use services::object_store::ObjectStore;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub jwks: Arc<JwksCache>,
    pub s3_service: Arc<dyn ObjectStore>,
    pub health: Arc<HealthCache>,
}
