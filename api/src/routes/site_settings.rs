use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::SiteSettings;
use crate::services::s3::S3Error;
use crate::AppState;

/// The S3 key the settings live under. The public site fetches this object
/// directly from S3 (like the content manifests), so `PUT` stores it public.
pub const SITE_SETTINGS_KEY: &str = "site-settings.json";

pub async fn get_site_settings_handler(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    match state.s3_service.get_object(SITE_SETTINGS_KEY).await {
        // A parse failure must NOT be a 200: the admin editor would load
        // garbage and a save would overwrite the real settings.
        Ok(data) => {
            let settings: SiteSettings = serde_json::from_slice(&data)
                .map_err(|e| AppError::internal("Stored site settings are invalid", e))?;
            Ok(Json(json!(settings)))
        }
        // The object not existing yet legitimately means "all defaults" —
        // serialized from the model so this answer cannot drift from it as
        // settings are added.
        Err(S3Error::NotFound) => Ok(Json(json!(SiteSettings::default()))),
        Err(e) => Err(AppError::internal("Failed to fetch site settings", e)),
    }
}

pub async fn update_site_settings_handler(
    State(state): State<AppState>,
    Json(settings): Json<SiteSettings>,
) -> Result<Json<Value>, AppError> {
    let settings_str = serde_json::to_string(&settings)
        .map_err(|e| AppError::internal("Failed to serialize site settings", e))?;

    state
        .s3_service
        .put_object(SITE_SETTINGS_KEY, settings_str.into(), true)
        .await
        .map_err(|e| AppError::internal("Failed to update site settings", e))?;

    Ok(Json(json!({"message": "Site settings updated"})))
}
