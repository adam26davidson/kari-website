//! Central application error type.
//!
//! Handlers return `Result<_, AppError>` so every failure maps to an honest
//! HTTP status with a `{"error": ...}` JSON body, instead of each handler
//! hand-rolling (and sometimes forgetting) its own status mapping.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    NotFound(&'static str),
    BadRequest(&'static str),
    Internal(&'static str),
}

impl AppError {
    /// Build an `Internal` error, logging the underlying cause. The client
    /// sees only `message`; the detail goes to the server log.
    pub fn internal(message: &'static str, err: impl std::fmt::Display) -> Self {
        tracing::error!("{}: {}", message, err);
        AppError::Internal(message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (status, Json(json!({"error": message}))).into_response()
    }
}
