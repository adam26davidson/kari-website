//! The admin helper's endpoints.
//!
//! All of them live behind the admin JWT, like the rest of `secure_routes` —
//! there is one admin, so a valid token IS the authorization. The handlers
//! stay thin: `services::assistant` owns the ceilings and the model loop.

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::assistant::{
    create_session, decide_on_draft, load_session, send_message, AssistantSession, DraftDecision,
    PageContext,
};
use crate::AppState;

/// Reject anything that is not a uuid before it becomes part of an S3 key.
///
/// This is the only place a caller-supplied string reaches the key builder,
/// and `assistant/../../site-settings.json` would otherwise be a legal key.
/// Sessions ids are generated server-side, so demanding a uuid costs nothing.
fn validated_id(id: &str) -> Result<&str, AppError> {
    Uuid::parse_str(id)
        .map(|_| id)
        .map_err(|_| AppError::NotFound("That conversation has ended"))
}

/// What the admin renders. Deliberately NOT the stored session: the raw
/// `api_messages` (system context, tool plumbing, thinking blocks) are the
/// model's business, and sending them to the browser would leak the prompt.
fn session_view(session: &AssistantSession, turns_allowed: u32) -> Value {
    json!({
        "id": session.id,
        "messages": session.display,
        "turnsRemaining": turns_allowed.saturating_sub(session.turns),
        // The draft awaiting her decision, if any — title and the plain
        // sentence the card shows. The issue body the model wrote is
        // deliberately NOT here: it is written for whoever picks the issue
        // up, and showing it would turn a calm card into a form to read.
        "draft": session.pending_draft.as_ref().map(|draft| json!({
            "kind": draft.kind,
            "title": draft.title,
            "summary": draft.summary,
        })),
    })
}

/// Whether the helper can run at all. The one route that answers 200 when
/// unconfigured — it is how the admin knows to show the resting panel
/// instead of a broken one. Reports configuration presence only; no key, no
/// model name, nothing an attacker could use.
pub async fn assistant_status_handler(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({
        "available": state.assistant.is_available(),
        "canFile": state.assistant.can_file(),
    })))
}

pub async fn create_session_handler(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    // Refuse before writing anything: an unconfigured host should not
    // accumulate empty session objects in the bucket.
    if !state.assistant.is_available() {
        return Err(AppError::Unavailable(
            crate::services::assistant::RESTING_MESSAGE,
        ));
    }
    let session = create_session(state.s3_service.as_ref()).await?;
    Ok(Json(session_view(
        &session,
        state.assistant.limits().max_turns_per_session,
    )))
}

/// Reload a conversation — what the widget calls after a page reload, with
/// the id it kept in local storage.
pub async fn get_session_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    if !state.assistant.is_available() {
        return Err(AppError::Unavailable(
            crate::services::assistant::RESTING_MESSAGE,
        ));
    }
    let session = load_session(state.s3_service.as_ref(), validated_id(&id)?).await?;
    Ok(Json(session_view(
        &session,
        state.assistant.limits().max_turns_per_session,
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub text: String,
    /// What she is looking at. Absent is fine — the helper simply has less
    /// to go on.
    #[serde(default)]
    pub context: PageContext,
}

pub async fn send_message_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<Value>, AppError> {
    let session = send_message(
        &state.assistant,
        state.s3_service.as_ref(),
        validated_id(&id)?,
        &body.text,
        &body.context,
    )
    .await?;
    Ok(Json(session_view(
        &session,
        state.assistant.limits().max_turns_per_session,
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftDecisionRequest {
    /// `"file"` or `"dismiss"`. Anything else is a bad request rather than
    /// a guess — the two actions are not interchangeable.
    pub action: String,
}

/// Her decision about the drafted issue on screen.
///
/// The ONLY route that creates a GitHub issue, and it does so because she
/// pressed a button — which is what makes the confirmation real rather than
/// something the model could talk itself out of.
pub async fn draft_decision_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<DraftDecisionRequest>,
) -> Result<Json<Value>, AppError> {
    let decision = match body.action.as_str() {
        "file" => DraftDecision::File,
        "dismiss" => DraftDecision::Dismiss,
        _ => {
            return Err(AppError::BadRequest(
                "That is not something to do with a draft",
            ))
        }
    };
    let session = decide_on_draft(
        &state.assistant,
        state.s3_service.as_ref(),
        validated_id(&id)?,
        decision,
    )
    .await?;
    Ok(Json(session_view(
        &session,
        state.assistant.limits().max_turns_per_session,
    )))
}
