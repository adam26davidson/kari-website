//! Health endpoint for external uptime monitoring (Route 53 health checks).
//!
//! Probes the full dependency chain the site needs: the API process itself
//! plus S3 read AND write access — the write probe exists specifically to
//! catch permission/credential breakage of the kind that silently broke all
//! admin saves in July 2026.
//!
//! Route 53 checkers hit this endpoint roughly once per second in aggregate,
//! so the probe result is cached: at most one S3 round trip per minute.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::{extract::State, http::StatusCode, response::Json};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::services::object_store::ObjectStore;
use crate::services::s3::S3Error;
use crate::AppState;

const PROBE_TTL: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct HealthCache {
    last: Mutex<Option<(Instant, Result<(), String>)>>,
}

impl HealthCache {
    async fn check(&self, s3: &dyn ObjectStore) -> Result<(), String> {
        let mut last = self.last.lock().await;
        if let Some((at, result)) = &*last {
            if at.elapsed() < PROBE_TTL {
                return result.clone();
            }
        }
        let result = probe(s3).await;
        *last = Some((Instant::now(), result.clone()));
        result
    }
}

async fn probe(s3: &dyn ObjectStore) -> Result<(), String> {
    // Read probe: a missing object is fine (fresh bucket); permission or
    // connectivity failures are not.
    match s3.get_object("haiku.json").await {
        Ok(_) | Err(S3Error::NotFound) => {}
        Err(e) => return Err(format!("S3 read probe failed: {e}")),
    }

    // Write probe. The object is tagged public=false so it is not readable
    // through the bucket's public-read policy.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();
    s3.put_object("_health", stamp.into_bytes(), false)
        .await
        .map_err(|e| format!("S3 write probe failed: {e}"))?;

    Ok(())
}

pub async fn health_handler(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match state.health.check(state.s3_service.as_ref()).await {
        Ok(()) => (StatusCode::OK, Json(json!({"status": "ok"}))),
        Err(e) => {
            tracing::error!("Health check failed: {e}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"status": "unhealthy"})),
            )
        }
    }
}
