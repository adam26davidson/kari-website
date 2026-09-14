//! A minimal client for Anthropic's Messages API.
//!
//! Rust has no official Anthropic SDK, so this speaks the HTTP API directly
//! with the `reqwest` client the crate already depends on — the same shape as
//! the JWKS fetch in `middleware/auth.rs`. It is deliberately small: one
//! non-streaming `POST /v1/messages`, enough serde to send a conversation and
//! read the reply back, and an error type that separates "upstream is busy,
//! try later" from "we sent something wrong".
//!
//! Assistant turns are stored and replayed as RAW JSON (`ApiMessage::content`
//! is a `serde_json::Value`). That is on purpose: the API's content-block set
//! grows over time (thinking blocks, fallback blocks, tool blocks), and blocks
//! must be echoed back unchanged on the next turn. Round-tripping them through
//! a typed enum would silently drop any block this file does not know about,
//! so the loop keeps the bytes and only *reads* the parts it understands.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Anthropic's API version header value. Pinned, not configurable: a
/// different version is a different wire format, which is a code change.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";

pub const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";

/// The current Opus. Overridable via `ANTHROPIC_MODEL` so a model change is a
/// config change on the host rather than a deploy.
pub const DEFAULT_MODEL: &str = "claude-opus-5";

/// Thinking depth. Opus 5 thinks adaptively by default and `high` effort is
/// the API default; `medium` keeps the helper's answers prompt and its cost
/// bounded, which is what this feature was asked for.
pub const DEFAULT_EFFORT: &str = "medium";

/// Ceiling on one reply. Adaptive thinking is billed inside this, so it is
/// not as generous as it looks — but the helper writes chat-sized answers,
/// and a smaller number is a cheaper accident when it does not. Overridable
/// via `ANTHROPIC_MAX_TOKENS`, so trimming the helper's most expensive knob
/// is a host edit and a restart rather than a deploy.
pub const DEFAULT_MAX_TOKENS: u32 = 8192;

/// Server-side refusal fallbacks: on a policy decline the API re-runs the
/// turn on another model inside the same call, instead of handing us a dead
/// turn. `"default"` lets Anthropic pick, so there is no model list to keep
/// current. Paired header value below — the two forms are not interchangeable.
pub const DEFAULT_FALLBACKS: &str = "default";
pub const FALLBACKS_BETA: &str = "server-side-fallback-2026-07-01";

/// An Opus turn with thinking can take well over a minute. The host-side
/// timeout has to outlast that or the helper looks broken exactly when it is
/// working hardest.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

/// Everything needed to talk to Anthropic, read once at startup.
///
/// There is no `Default`: the absence of a config IS the unconfigured state,
/// represented as `Option<AnthropicConfig>` by the caller. That keeps "no API
/// key" a single well-typed condition rather than an empty string to remember
/// to check.
#[derive(Clone, Debug)]
pub struct AnthropicConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub effort: String,
    /// Ceiling on one reply, `ANTHROPIC_MAX_TOKENS`.
    pub max_tokens: u32,
    /// `None` disables the fallbacks parameter and its beta header entirely
    /// (set `ANTHROPIC_FALLBACKS=off`), so the feature can be switched off on
    /// the host if the beta ever changes shape.
    pub fallbacks: Option<String>,
}

/// Read `var`, treating unset and blank-or-whitespace alike as absent. A
/// half-configured host (`ANTHROPIC_API_KEY=`) should degrade to the resting
/// state, not send an empty credential.
fn env_opt(var: &str) -> Option<String> {
    std::env::var(var)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Read a positive whole number from `var`.
///
/// Anything unparseable — or a zero, which would silently turn the ceiling it
/// configures into "never" — is ignored with a warning, so a typo on the host
/// degrades to the built-in default rather than to a helper that refuses
/// every message. Shared with `assistant::AssistantLimits`, which reads its
/// own ceilings the same way.
pub(crate) fn env_positive<T>(var: &str) -> Option<T>
where
    T: std::str::FromStr + Default + PartialEq,
{
    let raw = env_opt(var)?;
    match raw.parse::<T>() {
        Ok(value) if value != T::default() => Some(value),
        _ => {
            tracing::warn!("ignoring {var}={raw:?}: expected a positive whole number");
            None
        }
    }
}

impl AnthropicConfig {
    /// Build from the environment, or `None` when there is no API key.
    ///
    /// Every variable except the key has a default, so configuring this
    /// feature in production is one secret and nothing else.
    pub fn from_env() -> Option<Self> {
        let api_key = env_opt("ANTHROPIC_API_KEY")?;
        Some(Self {
            api_key,
            base_url: env_opt("ANTHROPIC_BASE_URL")
                .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
                .trim_end_matches('/')
                .to_string(),
            model: env_opt("ANTHROPIC_MODEL").unwrap_or_else(|| DEFAULT_MODEL.to_string()),
            effort: env_opt("ANTHROPIC_EFFORT").unwrap_or_else(|| DEFAULT_EFFORT.to_string()),
            max_tokens: env_positive("ANTHROPIC_MAX_TOKENS").unwrap_or(DEFAULT_MAX_TOKENS),
            fallbacks: match env_opt("ANTHROPIC_FALLBACKS") {
                Some(v) if v.eq_ignore_ascii_case("off") => None,
                Some(v) => Some(v),
                None => Some(DEFAULT_FALLBACKS.to_string()),
            },
        })
    }
}

/// One conversation turn, in the wire shape the Messages API uses.
///
/// `content` is raw JSON — either a string or an array of content blocks.
/// See the module comment for why it is not typed.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ApiMessage {
    pub role: String,
    pub content: Value,
}

impl ApiMessage {
    pub fn user(content: Value) -> Self {
        Self {
            role: "user".to_string(),
            content,
        }
    }

    pub fn assistant(content: Value) -> Self {
        Self {
            role: "assistant".to_string(),
            content,
        }
    }
}

/// Token usage for one call. Every field defaults, because usage gains
/// counters (cache reads, fallback iterations) and an unknown one must not
/// fail the whole response.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
pub struct Usage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: u64,
}

impl Usage {
    /// Everything billed for this call. Cache reads are cheaper per token but
    /// still count against a session ceiling whose job is to stop a runaway
    /// conversation, not to be an invoice.
    pub fn total(&self) -> u64 {
        self.input_tokens
            + self.output_tokens
            + self.cache_creation_input_tokens
            + self.cache_read_input_tokens
    }
}

#[derive(Debug, Deserialize)]
pub struct MessageResponse {
    /// The assistant turn's content blocks, kept verbatim for replay.
    #[serde(default)]
    pub content: Value,
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub usage: Usage,
}

/// A `tool_use` block, read out of an otherwise-opaque content array.
#[derive(Clone, Debug)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

impl MessageResponse {
    fn blocks(&self) -> &[Value] {
        self.content.as_array().map(|a| a.as_slice()).unwrap_or(&[])
    }

    /// Whether the turn produced anything at all.
    ///
    /// A refusal whose classifier fires BEFORE any output comes back as an
    /// empty `content` array, and the Messages API rejects a stored message
    /// with empty content — so a caller that replays transcripts has to know
    /// the difference between "the model said this" and "the model said
    /// nothing" before it keeps the blocks.
    pub fn has_content(&self) -> bool {
        !self.blocks().is_empty()
    }

    /// Every `text` block joined into one string — what the admin shows.
    pub fn text(&self) -> String {
        self.blocks()
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n\n")
            .trim()
            .to_string()
    }

    /// Every `tool_use` block. Inputs stay as parsed JSON — never
    /// string-matched, per Anthropic's guidance on escaping differences.
    pub fn tool_uses(&self) -> Vec<ToolUse> {
        self.blocks()
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
            .filter_map(|b| {
                Some(ToolUse {
                    id: b.get("id")?.as_str()?.to_string(),
                    name: b.get("name")?.as_str()?.to_string(),
                    input: b.get("input").cloned().unwrap_or_else(|| json!({})),
                })
            })
            .collect()
    }

    /// A safety classifier declined the turn. HTTP 200, so it has to be
    /// checked explicitly before the content is read.
    pub fn is_refusal(&self) -> bool {
        self.stop_reason.as_deref() == Some("refusal")
    }
}

#[derive(Debug)]
pub enum AnthropicError {
    /// The request never completed (DNS, connect, timeout).
    Transport(String),
    /// Rate limited, overloaded, or a 5xx — worth trying again later.
    Busy(String),
    /// A 4xx we caused: bad request shape, bad key, model gone.
    Rejected(String),
    /// A 2xx whose body did not parse as a message.
    Decode(String),
}

impl std::fmt::Display for AnthropicError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AnthropicError::Transport(e) => write!(f, "anthropic transport error: {e}"),
            AnthropicError::Busy(e) => write!(f, "anthropic unavailable: {e}"),
            AnthropicError::Rejected(e) => write!(f, "anthropic rejected the request: {e}"),
            AnthropicError::Decode(e) => write!(f, "anthropic response could not be read: {e}"),
        }
    }
}

impl std::error::Error for AnthropicError {}

/// Build the JSON body for one Messages API call.
///
/// `system` is sent as a single block carrying a `cache_control` breakpoint:
/// the whole transcript is resent every turn, and the system prompt is the
/// one part guaranteed byte-identical across turns, so caching it is free
/// money. `thinking` is deliberately absent — Opus 5 thinks adaptively when
/// the parameter is omitted, and `budget_tokens` is a 400 on this model.
/// There is no `temperature` for the same reason.
pub fn build_request(
    config: &AnthropicConfig,
    system: &str,
    messages: &[ApiMessage],
    tools: &[Value],
) -> Value {
    let mut body = json!({
        "model": config.model,
        "max_tokens": config.max_tokens,
        "system": [{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": messages,
        "output_config": {"effort": config.effort},
    });
    if !tools.is_empty() {
        body["tools"] = json!(tools);
    }
    if let Some(fallbacks) = &config.fallbacks {
        body["fallbacks"] = json!(fallbacks);
    }
    body
}

/// Send one Messages API request and read the reply.
///
/// Status mapping is the whole point of this function: 429 and 5xx become
/// `Busy` (the admin is told to try later and nothing is logged as a bug),
/// everything else 4xx becomes `Rejected` (a real fault worth a log).
pub async fn create_message(
    http: &reqwest::Client,
    config: &AnthropicConfig,
    body: &Value,
) -> Result<MessageResponse, AnthropicError> {
    let url = format!("{}/v1/messages", config.base_url);
    let mut request = http
        .post(&url)
        .header("x-api-key", &config.api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(body);
    // The beta header and the `fallbacks` parameter travel together; sending
    // one without the other is a 400.
    if config.fallbacks.is_some() {
        request = request.header("anthropic-beta", FALLBACKS_BETA);
    }

    let response = request
        .send()
        .await
        .map_err(|e| AnthropicError::Transport(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        // The body carries Anthropic's own message; it goes to the log, never
        // to the browser.
        let detail = response.text().await.unwrap_or_default();
        let detail = format!("{status}: {}", detail.chars().take(500).collect::<String>());
        return Err(if status.as_u16() == 429 || status.is_server_error() {
            AnthropicError::Busy(detail)
        } else {
            AnthropicError::Rejected(detail)
        });
    }

    response
        .json::<MessageResponse>()
        .await
        .map_err(|e| AnthropicError::Decode(e.to_string()))
}
