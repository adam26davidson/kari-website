pub mod error;
pub mod middleware;
pub mod migrate;
pub mod models;
pub mod routes;
pub mod services;

use middleware::auth::JwksCache;
use routes::health::HealthCache;
use services::assistant::AssistantState;
use services::object_store::ObjectStore;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub jwks: Arc<JwksCache>,
    pub s3_service: Arc<dyn ObjectStore>,
    pub health: Arc<HealthCache>,
    /// The admin helper. Always present, but usually unconfigured: with no
    /// `ANTHROPIC_API_KEY` it simply reports itself unavailable, and nothing
    /// else in the API is affected.
    pub assistant: Arc<AssistantState>,
}
