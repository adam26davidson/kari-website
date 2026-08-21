//! Which commit this binary was built from.
//!
//! The staging-only "What's on test" admin page needs to know what
//! production is running. It used to infer that from GitHub's deployment
//! records, but every unpromoted merge leaves a superseded production
//! deployment behind, so after ~20 merges without a promotion the scan ran
//! out of its unauthenticated API budget and the page gave up (#409).
//! Asking production itself is one request with no rate limit and cannot
//! be wrong.
//!
//! The sha is baked in at compile time by the deploy workflow
//! (`KARI_COMMIT_SHA`, passed into the cross container by `Cross.toml`), so
//! both environments' bundles report the commit they were built from. A
//! local `cargo run` has no sha and reports `null`; the page treats that
//! like a missing endpoint.

use axum::response::Json;
use serde_json::{json, Value};

/// The commit sha this binary was built from, or `null` when unknown.
pub const COMMIT_SHA: Option<&str> = option_env!("KARI_COMMIT_SHA");

pub async fn version_handler() -> Json<Value> {
    Json(json!({ "sha": COMMIT_SHA }))
}
