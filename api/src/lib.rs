pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;

use aws_sdk_s3::Client;
use jsonwebtoken::jwk::JwkSet;
use services::s3::S3Service;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub jwks: Arc<RwLock<JwkSet>>,
    pub s3_client: Client,
    pub bucket_name: String,
    pub s3_service: Arc<S3Service>,
}
