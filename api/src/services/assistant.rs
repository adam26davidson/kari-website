//! The admin helper: a conversation with Claude, held server-side.
//!
//! Everything secret and everything expensive lives here rather than in the
//! browser: the API key, the system prompt, the turn loop, and the ceilings.
//! The admin app only ever posts what Kari typed and renders what comes back.
//!
//! Sessions are S3 objects under `assistant/<uuid>.json`, written PRIVATE.
//! The repo has no database and this mirrors how blog content is already
//! stored, which is what lets a conversation survive a page reload.
//!
//! The whole feature is optional. With no `ANTHROPIC_API_KEY` the state is
//! simply unconfigured, every route answers 503, and the admin shows a calm
//! "resting" panel — so this ships and deploys long before any secret exists.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::anthropic::{
    create_message, AnthropicConfig, AnthropicError, ApiMessage, MessageResponse,
};
use crate::services::object_store::ObjectStore;
use crate::services::s3::S3Error;

/// Shown whenever the helper cannot run: unconfigured, or upstream is down.
/// The admin echoes this tone; keeping the words here means the two cannot
/// drift apart into "Service Unavailable".
pub const RESTING_MESSAGE: &str =
    "The helper is resting right now. Everything else works as usual — try again later.";

/// Shown when a ceiling is reached. Different from resting on purpose: this
/// one is about this conversation having gone on a while, not a fault.
pub const ENOUGH_FOR_NOW_MESSAGE: &str =
    "The helper has talked enough for now. Start a new conversation, or try again later.";

/// What the helper says when a safety classifier declines the turn. It never
/// reads as an accusation — she asked something ordinary and got an odd
/// answer, which is the honest framing.
pub const REFUSAL_MESSAGE: &str =
    "I'm not able to help with that one, sorry. Ask me something else about the site and I'll do my best.";

/// What the helper says if the tool loop runs out of room. Only reachable
/// when the model keeps asking for tools it cannot have.
pub const TANGLED_MESSAGE: &str =
    "I got a bit tangled trying to answer that. Could you ask me again, maybe in different words?";

/// Told to the model when it asks for a tool. In this slice it has none —
/// filing issues and reading the repo arrive in later work — so every tool
/// call gets this back and the model is expected to carry on in words.
pub const NO_TOOLS_YET: &str =
    "That isn't something I can do yet. Answer in words instead, and if she wants something logged, say the filing feature is coming soon.";

/// The S3 prefix sessions live under.
pub const SESSION_PREFIX: &str = "assistant/";

pub fn session_key(id: &str) -> String {
    format!("{SESSION_PREFIX}{id}.json")
}

/// Ceilings. These are the second line of defence; the first is the hard
/// monthly spend cap set on the Anthropic console, which no code can undo.
#[derive(Clone, Copy, Debug)]
pub struct AssistantLimits {
    /// How many times one turn may round-trip through tools before giving up.
    pub max_tool_iterations_per_turn: usize,
    /// How long one conversation may run.
    pub max_turns_per_session: u32,
    /// Cumulative tokens (in + out + cache) one conversation may spend.
    pub max_session_tokens: u64,
    /// How many turns this process will serve in a day. Process-local and
    /// reset by date — deliberately crude, because it is a backstop for a
    /// backstop and a restart costing us one extra day's turns is cheaper
    /// than a counter that needs storage.
    pub daily_turn_limit: u32,
}

impl Default for AssistantLimits {
    fn default() -> Self {
        Self {
            max_tool_iterations_per_turn: 6,
            max_turns_per_session: 40,
            max_session_tokens: 400_000,
            daily_turn_limit: 200,
        }
    }
}

/// Days since the epoch — the coarsest possible clock, and all the daily
/// counter needs. Avoids taking a date-time dependency for one integer.
fn today() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

#[derive(Debug, Default)]
struct DailyTurns {
    day: u64,
    count: u32,
}

/// The helper's process-wide state, carried on `AppState`.
///
/// The concurrency gate and the daily counter live HERE rather than in
/// `static`s (the `RENDITION_GATE` precedent in `routes::images`) because
/// there is exactly one `AssistantState` per process in production, so the
/// semantics are identical — while in tests each case gets its own, and a
/// shared global would otherwise leak counts between parallel tests.
pub struct AssistantState {
    config: Option<AnthropicConfig>,
    http: reqwest::Client,
    limits: AssistantLimits,
    /// One Anthropic call in flight at a time. The host is a ~1 GiB micro
    /// EC2 running two copies of this API; more importantly, serialising
    /// calls makes the spend rate predictable.
    gate: Semaphore,
    daily: Mutex<DailyTurns>,
}

impl AssistantState {
    pub fn new(config: Option<AnthropicConfig>, limits: AssistantLimits) -> Self {
        Self {
            config,
            // An Opus turn can outlast any default timeout. Falling back to a
            // plain client if the builder fails keeps this infallible — a
            // missing timeout is far better than a panic at startup.
            http: reqwest::Client::builder()
                .timeout(crate::services::anthropic::REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
            limits,
            gate: Semaphore::new(1),
            daily: Mutex::new(DailyTurns::default()),
        }
    }

    /// Read configuration from the environment. Every variable is optional,
    /// so this never fails and never panics — an unconfigured host simply
    /// gets a resting helper.
    pub fn from_env() -> Self {
        Self::new(AnthropicConfig::from_env(), AssistantLimits::default())
    }

    /// Is there an API key? This is all `GET /assistant/status` reports; the
    /// key itself never leaves this process.
    pub fn is_available(&self) -> bool {
        self.config.is_some()
    }

    /// Can the helper file GitHub issues? Not in this slice.
    pub fn can_file(&self) -> bool {
        false
    }

    pub fn limits(&self) -> AssistantLimits {
        self.limits
    }

    fn config(&self) -> Result<&AnthropicConfig, AppError> {
        self.config
            .as_ref()
            .ok_or(AppError::Unavailable(RESTING_MESSAGE))
    }

    /// Count one turn against today's allowance, resetting when the date
    /// rolls over.
    async fn claim_daily_turn(&self) -> Result<(), AppError> {
        let mut daily = self.daily.lock().await;
        let day = today();
        if daily.day != day {
            daily.day = day;
            daily.count = 0;
        }
        if daily.count >= self.limits.daily_turn_limit {
            tracing::warn!("assistant daily turn limit reached ({})", daily.count);
            return Err(AppError::TooManyRequests(ENOUGH_FOR_NOW_MESSAGE));
        }
        daily.count += 1;
        Ok(())
    }
}

impl Default for AssistantState {
    fn default() -> Self {
        Self::new(None, AssistantLimits::default())
    }
}

/// One line of the conversation as the admin shows it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMessage {
    /// `"user"` (Kari) or `"assistant"` (the helper).
    pub role: String,
    pub text: String,
}

impl DisplayMessage {
    pub fn user(text: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            text: text.into(),
        }
    }

    pub fn assistant(text: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            text: text.into(),
        }
    }
}

/// What page Kari is on and what she is looking at, sent with every turn so
/// guidance matches her screen. Every field is optional — the admin sends
/// what it knows, and a page that publishes nothing still works.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageContext {
    #[serde(default)]
    pub route: Option<String>,
    /// What kind of thing is open, in her words: "haiku", "photograph".
    #[serde(default)]
    pub what: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    /// True when there are unsaved changes on screen.
    #[serde(default)]
    pub dirty: Option<bool>,
}

impl PageContext {
    /// Render as a short block the model reads before her words. Plain lines
    /// rather than JSON: it is prose to the model either way, and prose is
    /// what it follows best.
    fn describe(&self) -> String {
        let mut lines = vec![];
        if let Some(route) = &self.route {
            lines.push(format!("She is on the admin page: {route}"));
        }
        if let Some(what) = &self.what {
            let title = self.title.as_deref().unwrap_or("(untitled)");
            match &self.id {
                Some(id) => lines.push(format!("She has this {what} open: \"{title}\" (id {id})")),
                None => lines.push(format!("She is adding a new {what}: \"{title}\"")),
            }
        }
        if self.dirty == Some(true) {
            lines.push("There are unsaved changes on screen.".to_string());
        }
        if lines.is_empty() {
            return String::new();
        }
        format!("<page-context>\n{}\n</page-context>\n\n", lines.join("\n"))
    }
}

/// A stored conversation.
///
/// `api_messages` is what the model sees (raw content blocks, replayed
/// verbatim); `display` is the much smaller projection the admin renders.
/// Keeping both means the UI never has to understand content blocks and the
/// model never loses a block we failed to model.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantSession {
    pub id: String,
    #[serde(default)]
    pub api_messages: Vec<ApiMessage>,
    #[serde(default)]
    pub display: Vec<DisplayMessage>,
    #[serde(default)]
    pub turns: u32,
    #[serde(default)]
    pub tokens_used: u64,
    /// Reserved for the confirmation step that files an issue — always
    /// `None` in this slice, but stored so an older session object still
    /// parses once that ships.
    #[serde(default)]
    pub pending_draft: Option<Value>,
    #[serde(default)]
    pub filed_issues: Vec<Value>,
}

/// Create and persist an empty session. The id is generated HERE — a
/// client-supplied one would be a client-supplied S3 key.
pub async fn create_session(store: &dyn ObjectStore) -> Result<AssistantSession, AppError> {
    let session = AssistantSession {
        id: Uuid::new_v4().to_string(),
        ..Default::default()
    };
    save_session(store, &session).await?;
    Ok(session)
}

pub async fn load_session(store: &dyn ObjectStore, id: &str) -> Result<AssistantSession, AppError> {
    match store.get_object(&session_key(id)).await {
        // Corrupt stored JSON is a hard error, not an empty conversation:
        // silently starting over would lose a transcript she may be halfway
        // through, and hide the fault. Same call as `site_settings`.
        Ok(data) => serde_json::from_slice(&data)
            .map_err(|e| AppError::internal("Stored conversation is invalid", e)),
        Err(S3Error::NotFound) => Err(AppError::NotFound("That conversation has ended")),
        Err(e) => Err(AppError::internal("Failed to fetch the conversation", e)),
    }
}

/// Write the session back.
///
/// Last write wins. S3 has no read-modify-write, and that is fine here:
/// there is one admin, and the widget will not send a second message while
/// the first is in flight. Same pragmatism as the rendition gate's comment.
pub async fn save_session(
    store: &dyn ObjectStore,
    session: &AssistantSession,
) -> Result<(), AppError> {
    let body = serde_json::to_vec(session)
        .map_err(|e| AppError::internal("Failed to save the conversation", e))?;
    store
        .put_object(&session_key(&session.id), Bytes::from(body), false)
        .await
        .map_err(|e| AppError::internal("Failed to save the conversation", e))
}

/// The helper's standing instructions.
///
/// Byte-identical on every turn, which is what makes the cache breakpoint in
/// `anthropic::build_request` pay: the transcript is resent each time, and
/// this prefix is the part that never changes.
pub fn system_prompt() -> String {
    // The page map is written the way the admin menu reads, so the helper
    // names sections the way Kari sees them rather than the way the routes
    // are spelled.
    let pages = "\
- Home (/home) — the greeting and introduction on the public home page
- Haiku (/haiku) — the list of haiku, and the editor for one of them
- Haiga (/haiga) — haiga (a haiku with a picture), list and editor
- Photography (/photography) — photographs, list and editor
- Other works (/other-works) — longer written pieces, list and editor
- Appearance (/background) — the site's background photograph, the header \
colours, and the fonts
- Image cleanup (/image-cleanup) — finds pictures no longer used anywhere \
and offers to remove them";

    format!(
        "You are the helper inside Kari Davidson's admin workshop — the \
private part of her website where she publishes her own writing and \
photography.

You are talking to Kari. She is a poet and photographer, not a developer, \
and she never will be. She uses this workshop for everything: publishing \
haiku and haiga, uploading photographs, editing the home page and the \
site's appearance.

You have three jobs, and you decide which one a conversation needs:

1. Answering how-to and is-it-possible questions. Walk her through it a \
step at a time, naming what she will actually see on screen — the section \
in the menu, the button, the field. She may move between pages as you go; \
you are told which page she is on with each message, so pick up from where \
she is. If what she wants is not supported, say so plainly and ASK whether \
she would like it written down as a request — never assume.

2. Hearing about something broken. Ask what she was doing and what she \
expected to happen, but only as much as you genuinely need.

3. Hearing an idea for the site. Ask enough to understand the outcome she \
wants.

For jobs 2 and 3 the workshop cannot yet write things down for her. When \
you have understood what she means, say so warmly, tell her that logging it \
is coming soon, and suggest she mention it to Adam in the meantime. Do not \
pretend to have filed anything.

How to talk:

- Plain, warm and unhurried. Short paragraphs. No lists of options unless \
she asks for choices.
- Her words, not the code's: haiku, haiga, photograph, home page, \
background. Never \"item\", \"entity\", \"manifest\", \"S3\", \"API\", \
\"endpoint\", \"deploy\", or an error code.
- Never scold her and never suggest she has broken something. If something \
went wrong, say what happened and what to do next.
- No exclamation marks. Do not open by restating her question.
- If you are not sure, say you are not sure rather than guessing at how the \
site works.

The sections of her workshop:

{pages}

The workshop saves each page separately — there is a save or publish button \
on the page she is editing, and nothing is public until she saves."
    )
}

/// Add one message to the conversation and return the updated session.
///
/// This is the whole turn: ceilings, the tool loop, and the write-back.
pub async fn send_message(
    state: &Arc<AssistantState>,
    store: &dyn ObjectStore,
    session_id: &str,
    text: &str,
    context: &PageContext,
) -> Result<AssistantSession, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest("There was no message to send"));
    }
    // Checked before anything is loaded or written, so an unconfigured host
    // does no work at all.
    let config = state.config()?;
    let limits = state.limits;

    let mut session = load_session(store, session_id).await?;
    if session.turns >= limits.max_turns_per_session
        || session.tokens_used >= limits.max_session_tokens
    {
        return Err(AppError::TooManyRequests(ENOUGH_FOR_NOW_MESSAGE));
    }
    state.claim_daily_turn().await?;

    // The model sees her words with the page context in front of them; the
    // transcript she reads shows only what she typed.
    session.api_messages.push(ApiMessage::user(json!([{
        "type": "text",
        "text": format!("{}{}", context.describe(), text),
    }])));
    session.display.push(DisplayMessage::user(text));

    let system = system_prompt();
    let mut reply: Option<String> = None;

    for _ in 0..limits.max_tool_iterations_per_turn {
        let body =
            crate::services::anthropic::build_request(config, &system, &session.api_messages, &[]);
        let response = call_anthropic(state, config, &body).await?;
        session.tokens_used += response.usage.total();
        // Echoed back unchanged on the next iteration — thinking blocks and
        // any block type this code does not know about included.
        session
            .api_messages
            .push(ApiMessage::assistant(response.content.clone()));

        if response.is_refusal() {
            reply = Some(REFUSAL_MESSAGE.to_string());
            break;
        }

        let tool_uses = response.tool_uses();
        if tool_uses.is_empty() {
            let text = response.text();
            reply = Some(if text.is_empty() {
                TANGLED_MESSAGE.to_string()
            } else {
                text
            });
            break;
        }

        // The helper has no tools in this slice. Answering every call with a
        // clear error keeps the loop honest — and keeps the plumbing that
        // later slices hang real tools on exercised today.
        let results: Vec<Value> = tool_uses
            .iter()
            .map(|tool| {
                tracing::info!("assistant asked for an unavailable tool: {}", tool.name);
                json!({
                    "type": "tool_result",
                    "tool_use_id": tool.id,
                    "is_error": true,
                    "content": NO_TOOLS_YET,
                })
            })
            .collect();
        session.api_messages.push(ApiMessage::user(json!(results)));
    }

    session
        .display
        .push(DisplayMessage::assistant(reply.unwrap_or_else(|| {
            tracing::warn!("assistant turn exhausted its tool iterations");
            TANGLED_MESSAGE.to_string()
        })));
    session.turns += 1;
    save_session(store, &session).await?;
    Ok(session)
}

/// One Anthropic call, serialised behind the gate and with its failures
/// translated into something the admin can show.
async fn call_anthropic(
    state: &AssistantState,
    config: &AnthropicConfig,
    body: &Value,
) -> Result<MessageResponse, AppError> {
    let _permit = state
        .gate
        .acquire()
        .await
        .map_err(|e| AppError::internal("The helper could not start", e))?;
    create_message(&state.http, config, body)
        .await
        .map_err(|e| match e {
            // Busy and transport failures are both "try later" from her side,
            // and neither is a bug worth an apology.
            AnthropicError::Busy(detail) | AnthropicError::Transport(detail) => {
                tracing::warn!("assistant upstream unavailable: {}", detail);
                AppError::Unavailable(RESTING_MESSAGE)
            }
            other => AppError::internal("The helper could not answer", other),
        })
}
