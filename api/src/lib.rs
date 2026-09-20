pub mod error;
pub mod middleware;
pub mod migrate;
pub mod models;
pub mod routes;
pub mod services;

use middleware::auth::{DevAuth, JwksCache};
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
    /// The local development auth bypass (#266). Injected rather than read
    /// from the environment where it is used, so tests stay parallel-safe;
    /// `DevAuth::default()` (what every test builds) accepts nothing, and a
    /// build without the `dev-auth` cargo feature cannot accept anything at
    /// all.
    pub dev_auth: DevAuth,
}
