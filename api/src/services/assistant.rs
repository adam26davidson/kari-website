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

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

use crate::error::AppError;
use crate::services::anthropic::{
    create_message, env_positive, AnthropicConfig, AnthropicError, ApiMessage, MessageResponse,
};
use crate::services::github_issues::{self, GithubError, GithubIssuesConfig};
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

/// Told to the model when it asks for a tool it does not have on a host
/// with NO GitHub token. Reading the repo arrives in later work, and
/// `propose_issue` is undeclared here too — so filing really is still to
/// come, which is what `system_prompt`'s no-filing half says as well.
pub const NO_TOOLS_YET: &str =
    "That isn't something I can do yet. Answer in words instead, and if she wants something logged, say the filing feature is coming soon.";

/// The same, on a host that CAN file. `propose_issue` is declared here and
/// the button behind it works, so a call that lands here is for something
/// else — reading the repo, say — and telling the model to promise filing
/// "soon" would contradict both its own instructions and the card she can
/// already be looking at.
pub const NO_OTHER_TOOLS_YET: &str =
    "That isn't something I can do yet. Answer in words instead, and if she wants something written down, use propose_issue as usual.";

/// Which of the two an unknown tool call is answered with.
fn no_such_tool(can_file: bool) -> &'static str {
    if can_file {
        NO_OTHER_TOOLS_YET
    } else {
        NO_TOOLS_YET
    }
}

/// The one tool the helper has: writing up a draft issue for her to look at.
pub const PROPOSE_ISSUE_TOOL: &str = "propose_issue";

/// The label every issue filed this way carries. The pipeline's pick order
/// reads it as "product work, pick first" (`automation/backlog-shortlist.sh`),
/// which is the whole point of the feature: her words go to the front.
pub const USER_FEEDBACK_LABEL: &str = "user-feedback";

/// Answered to `propose_issue`. The tool does NOT file anything — it puts a
/// draft on her screen and stops, and the model is told so plainly, because
/// a model that believes it has filed would tell her it had.
pub const DRAFT_ON_SCREEN: &str =
    "The draft is now on her screen with a button to file it and a button to leave it. \
Nothing has been filed. Tell her in one short line that it is there to look over, \
and leave the decision to her.";

/// Answered to a `propose_issue` call missing a field. The model is asked to
/// try again rather than a half-draft reaching her screen.
pub const DRAFT_INCOMPLETE: &str =
    "That draft was missing something. Call propose_issue again with all four of \
kind, title, summary and body filled in.";

/// Shown as the helper's own line once an issue is filed. Warm, brief, and
/// promising only what is true: someone will look.
pub const FILED_MESSAGE: &str = "Filed — I'll make sure it gets looked at.";

/// Shown when she asks to file on a host that cannot: no GitHub token. The
/// conversation is unaffected, so the words point somewhere useful rather
/// than asking her to wait for something that will not change on its own.
pub const FILING_OFF_MESSAGE: &str =
    "I can't write things down just yet. Tell Adam what you need and he'll get it noted.";

/// Shown when filing was attempted and did not land. The draft is kept, so
/// trying again is worth doing — and the words say so.
///
/// Only ever sent for a failure that happened BEFORE GitHub created
/// anything, which is what makes the promise true. A filing that reached
/// GitHub and could not then be saved answers with the finished
/// conversation instead (`decide_on_draft`): this message there would
/// invite a press that filed the issue a second time.
pub const FILING_FAILED_MESSAGE: &str =
    "Couldn't write that down just now — it's still here, so you can try again in a moment.";

/// What a `file` with no draft on the session gets. Only reachable from a
/// stale panel: two windows deciding on one conversation, a reload
/// mid-decision, or a filing that landed with its answer lost on the way
/// back. The admin reads this 400 as "the server has settled it" and
/// re-reads the conversation rather than offering a retry that cannot
/// succeed (`use-assistant-session.ts`).
pub const NOTHING_TO_FILE_MESSAGE: &str = "There is nothing to file just now.";

/// The S3 prefix sessions live under.
pub const SESSION_PREFIX: &str = "assistant/";

pub fn session_key(id: &str) -> String {
    format!("{SESSION_PREFIX}{id}.json")
}

/// Ceilings. These are the second line of defence; the first is the hard
/// monthly spend cap set on the Anthropic console, which no code can undo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

impl AssistantLimits {
    /// The defaults above, with each ceiling overridable on the host.
    ///
    /// Spend is the one thing about this feature the maintainer may need to
    /// change in a hurry, and a hurry is exactly when a code change and a
    /// deploy are the wrong tools. Every variable is optional and a bad value
    /// is ignored with a warning (see `env_positive`), so a host that sets
    /// none of them — which is every host today — behaves exactly as before.
    pub fn from_env() -> Self {
        let defaults = Self::default();
        Self {
            max_tool_iterations_per_turn: env_positive("ASSISTANT_MAX_TOOL_ITERATIONS_PER_TURN")
                .unwrap_or(defaults.max_tool_iterations_per_turn),
            max_turns_per_session: env_positive("ASSISTANT_MAX_TURNS_PER_SESSION")
                .unwrap_or(defaults.max_turns_per_session),
            max_session_tokens: env_positive("ASSISTANT_MAX_SESSION_TOKENS")
                .unwrap_or(defaults.max_session_tokens),
            daily_turn_limit: env_positive("ASSISTANT_DAILY_TURN_LIMIT")
                .unwrap_or(defaults.daily_turn_limit),
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
    /// Filing configuration, or `None` on a host with no GitHub token —
    /// independent of the Anthropic config, so a host can talk without
    /// filing (and, in principle, the reverse).
    github: Option<GithubIssuesConfig>,
    /// A separate client for GitHub: filing is one small POST she is
    /// waiting on, and it must not inherit the three-minute timeout an
    /// Opus turn needs.
    github_http: reqwest::Client,
    limits: AssistantLimits,
    /// One Anthropic call in flight at a time. The host is a ~1 GiB micro
    /// EC2 running two copies of this API; more importantly, serialising
    /// calls makes the spend rate predictable.
    gate: Semaphore,
    daily: Mutex<DailyTurns>,
    /// One write lock per conversation — see `session_lock`.
    session_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
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
            github: None,
            github_http: reqwest::Client::builder()
                .timeout(github_issues::REQUEST_TIMEOUT)
                .build()
                .unwrap_or_default(),
            limits,
            gate: Semaphore::new(1),
            daily: Mutex::new(DailyTurns::default()),
            session_locks: Mutex::new(HashMap::new()),
        }
    }

    /// Give the helper somewhere to file issues. Chainable, and separate
    /// from `new` so the talking half can be configured on its own — which
    /// is exactly the state a host in the middle of being provisioned is in.
    pub fn with_github(mut self, github: Option<GithubIssuesConfig>) -> Self {
        self.github = github;
        self
    }

    /// Read configuration from the environment. Every variable is optional,
    /// so this never fails and never panics — an unconfigured host simply
    /// gets a resting helper.
    pub fn from_env() -> Self {
        Self::new(AnthropicConfig::from_env(), AssistantLimits::from_env())
            .with_github(GithubIssuesConfig::from_env())
    }

    /// Is there an API key? This is all `GET /assistant/status` reports; the
    /// key itself never leaves this process.
    pub fn is_available(&self) -> bool {
        self.config.is_some()
    }

    /// Can the helper file GitHub issues? Configuration presence only —
    /// this is what `GET /assistant/status` reports, and what decides
    /// whether the `propose_issue` tool is offered to the model at all. A
    /// helper that cannot file must never draft: it would be promising her
    /// something the button behind it cannot do.
    pub fn can_file(&self) -> bool {
        self.github.is_some()
    }

    pub fn limits(&self) -> AssistantLimits {
        self.limits
    }

    fn config(&self) -> Result<&AnthropicConfig, AppError> {
        self.config
            .as_ref()
            .ok_or(AppError::Unavailable(RESTING_MESSAGE))
    }

    fn github(&self) -> Result<&GithubIssuesConfig, AppError> {
        self.github
            .as_ref()
            .ok_or(AppError::Unavailable(FILING_OFF_MESSAGE))
    }

    /// The write lock for one conversation. Hold it across the whole
    /// load → mutate → save, not just the save.
    ///
    /// The store has no compare-and-set, so every write is last-write-wins.
    /// What used to make that safe was that a conversation had one writer.
    /// It has two now — a turn (`send_message`) and her decision about the
    /// draft on screen (`decide_on_draft`) — and a turn holds its loaded
    /// copy for as long as the model takes to answer, which is tens of
    /// seconds with the card's buttons live in front of her. Without this,
    /// filing mid-turn created the GitHub issue and was then erased by the
    /// turn's save: the card came back, pressing it again filed a SECOND
    /// issue, and the model was never told about the first.
    ///
    /// In-process is the whole story: there is exactly one API process per
    /// environment, each with its own bucket (`docs/test-deployment-setup.md`),
    /// so serialising here serialises every writer there is.
    async fn session_lock(&self, id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.session_locks.lock().await;
        // Forget conversations nobody is working on, so a long-lived
        // process does not keep one mutex per conversation it ever served.
        // An entry in use is referenced by its holder as well as by this
        // map, so a strong count of one means idle — and a count of one
        // cannot be observed while someone holds it, since holding means
        // holding the `Arc` this returns.
        locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        locks.entry(id.to_string()).or_default().clone()
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

/// An issue that exists on GitHub, as both the transcript and the stored
/// session refer to it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FiledIssue {
    pub number: u64,
    pub url: String,
    pub title: String,
}

/// One line of the conversation as the admin shows it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMessage {
    /// `"user"` (Kari) or `"assistant"` (the helper).
    pub role: String,
    pub text: String,
    /// Set only on the line that confirms a filing, which the panel renders
    /// with a quiet link. Absent everywhere else — and absent, not null, so
    /// an ordinary line's JSON is exactly what it always was.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<FiledIssue>,
}

impl DisplayMessage {
    pub fn user(text: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            text: text.into(),
            issue: None,
        }
    }

    pub fn assistant(text: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            text: text.into(),
            issue: None,
        }
    }

    /// The helper's line confirming a filing, carrying somewhere to click.
    ///
    /// Kept in the transcript rather than beside it, so the confirmation
    /// survives a reload and stays attached to the conversation it came
    /// from instead of hovering over whatever she does next.
    pub fn filed(issue: FiledIssue) -> Self {
        Self {
            role: "assistant".to_string(),
            text: FILED_MESSAGE.to_string(),
            issue: Some(issue),
        }
    }
}

/// A would-be issue, waiting for her decision.
///
/// `summary` is for her — the plain sentence the card shows. `body` is for
/// whoever picks the issue up. The model writes both; nothing is filed
/// until the confirm endpoint is called.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDraft {
    /// `"bug"` or `"idea"` — decides how the card introduces itself.
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub body: String,
    /// What she was looking at when the draft was written, captured here
    /// rather than at filing time: by then she may have moved on, and the
    /// issue wants the page the problem was on.
    #[serde(default)]
    pub context: PageContext,
}

impl IssueDraft {
    /// Read a `propose_issue` call's input.
    ///
    /// Parsed as JSON and never string-matched (Anthropic's guidance on
    /// escaping differences), and `None` when a field is missing or blank —
    /// a card with an empty title is worse than asking the model again.
    fn from_input(input: &Value, context: &PageContext) -> Option<Self> {
        let field = |name: &str| {
            input
                .get(name)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        };
        Some(Self {
            kind: field("kind").unwrap_or_else(|| "idea".to_string()),
            title: field("title")?,
            summary: field("summary")?,
            body: field("body")?,
            context: context.clone(),
        })
    }

    /// How the helper refers to it in a note to itself.
    fn described(&self) -> &str {
        if self.kind == "bug" {
            "problem"
        } else {
            "idea"
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
    /// One plain sentence per thing that is known. Shared by the block the
    /// model reads each turn and the `## Context` section of a filed issue,
    /// so the two can never describe her screen differently.
    fn lines(&self) -> Vec<String> {
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
        lines
    }

    /// Render as a short block the model reads before her words. Plain lines
    /// rather than JSON: it is prose to the model either way, and prose is
    /// what it follows best.
    fn describe(&self) -> String {
        let lines = self.lines();
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
    /// The draft on her screen, if any. One at a time: a second
    /// `propose_issue` replaces the first, because the card is one card and
    /// a queue of drafts is not a thing she asked for.
    #[serde(default)]
    pub pending_draft: Option<IssueDraft>,
    #[serde(default)]
    pub filed_issues: Vec<FiledIssue>,
    /// Things that happened between turns which the model has to know about
    /// — that she filed a draft, or chose not to. Carried into the front of
    /// her next message rather than pushed in as a message of their own:
    /// the stored transcript alternates user and assistant turns, and the
    /// loop's replay guarantees are written in terms of that alternation.
    #[serde(default)]
    pub pending_notes: Vec<String>,
}

/// Create and persist an empty session. The id is generated HERE — a
/// client-supplied one would be a client-supplied S3 key, and it is also
/// why this needs no write lock: nothing else can name this conversation
/// until the id is in the reply.
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
/// Last write wins. S3 has no read-modify-write, so what keeps that safe is
/// the caller: every writer holds that conversation's write lock
/// (`AssistantState::session_lock`) across its whole load → mutate → save,
/// which is what makes "last" mean "the one that read the other's work".
/// Do not call this from a path that has not taken the lock.
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

/// What the model may ask for, given what this host can actually do.
///
/// Declared on EVERY request in the turn loop, continuations after a
/// `tool_result` included: the Messages API answers a request whose
/// transcript holds `tool_use`/`tool_result` blocks with a 400 if `tools`
/// is absent, so a loop that dropped them after the first call would break
/// the moment a tool was ever used.
///
/// Empty when the host cannot file, which is also what keeps the helper
/// honest there: with no tool to call it cannot offer to write anything
/// down, and `system_prompt` tells it so in words as well.
pub fn tools(can_file: bool) -> Vec<Value> {
    if !can_file {
        return vec![];
    }
    vec![json!({
        "name": PROPOSE_ISSUE_TOOL,
        "description": "Write up a problem she has reported, or an idea she \
    has described, as a draft issue for the site's developer. This does NOT file \
    anything: it puts the draft on her screen with a button to file it and a \
    button to leave it, and she decides. Call it once you understand what she \
    means — not to ask her whether she wants it written down, which you do in \
    words first.",
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["bug", "idea"],
                    "description": "\"bug\" when something is broken or not \
    behaving as she expected; \"idea\" for something new she would like.",
                },
                "title": {
                    "type": "string",
                    "description": "One short line naming the thing, in her \
    vocabulary — the issue's title.",
                },
                "summary": {
                    "type": "string",
                    "description": "One or two plain sentences FOR KARI, \
    shown on the card so she can tell at a glance that you understood her. No \
    technical words.",
                },
                "body": {
                    "type": "string",
                    "description": "The issue body, for whoever picks it up: \
    what she wants or what went wrong, what she expected instead, and which part \
    of the site it concerns. Markdown is fine. Do not include the conversation \
    or the page details — those are added for you.",
                },
            },
            "required": ["kind", "title", "summary", "body"],
            "additionalProperties": false,
        },
    })]
}

/// The helper's standing instructions.
///
/// Byte-identical on every turn, which is what makes the cache breakpoint in
/// `anthropic::build_request` pay: the transcript is resent each time, and
/// this prefix is the part that never changes. It differs between HOSTS (one
/// that can file says so), which costs nothing — a cache entry belongs to
/// one process anyway.
pub fn system_prompt(can_file: bool) -> String {
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

    // What to do with a problem or an idea once it is understood. The two
    // versions are the difference between a host that has been given a
    // GitHub token and one that has not; never promise the filing this
    // host cannot do.
    let filing = if can_file {
        "For jobs 2 and 3, once you understand what she means, call the \
propose_issue tool. That does not file anything: it puts a draft on her \
screen with a button to file it and a button to leave it, and she decides. \
After calling it, say in one short line that it is there for her to look \
over — do not ask her to confirm in words as well, and never say you have \
filed anything. If she asks you to change it, call propose_issue again with \
the new wording.

Only draft once you have what you need. For a problem that is what she was \
doing and what she expected; for an idea, the outcome she wants. One \
clarifying question at a time, and none at all when she has already told you."
    } else {
        "For jobs 2 and 3 the workshop cannot yet write things down for her. \
When you have understood what she means, say so warmly, tell her that \
logging it is coming soon, and suggest she mention it to Adam in the \
meantime. Do not pretend to have filed anything."
    };

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

{filing}

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

/// The content array for an assistant turn that says exactly `text`.
///
/// Used wherever the transcript has to record the words she was shown rather
/// than what the model sent, so the stored conversation stays replayable.
fn spoken(text: &str) -> Value {
    json!([{"type": "text", "text": text}])
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

    // Held for the whole turn, model call included: this is the long
    // writer, and a decision she makes while it runs must not be undone by
    // its save. See `AssistantState::session_lock`.
    let lock = state.session_lock(session_id).await;
    let _write = lock.lock().await;

    let mut session = load_session(store, session_id).await?;
    if session.turns >= limits.max_turns_per_session
        || session.tokens_used >= limits.max_session_tokens
    {
        return Err(AppError::TooManyRequests(ENOUGH_FOR_NOW_MESSAGE));
    }
    state.claim_daily_turn().await?;

    // The model sees her words with the page context in front of them, and
    // in front of that anything that happened since it last spoke (she
    // filed the draft, or left it). The transcript she reads shows only
    // what she typed.
    let notes = std::mem::take(&mut session.pending_notes);
    let notes = notes
        .iter()
        .map(|note| format!("<note>\n{note}\n</note>\n\n"))
        .collect::<String>();
    session.api_messages.push(ApiMessage::user(json!([{
        "type": "text",
        "text": format!("{notes}{}{text}", context.describe()),
    }])));
    session.display.push(DisplayMessage::user(text));

    let can_file = state.can_file();
    let system = system_prompt(can_file);
    let tools = tools(can_file);
    let mut reply: Option<String> = None;

    for _ in 0..limits.max_tool_iterations_per_turn {
        // `tools` goes on every request, not just the first: a continuation
        // whose transcript carries `tool_use`/`tool_result` blocks without
        // it is a 400.
        let body = crate::services::anthropic::build_request(
            config,
            &system,
            &session.api_messages,
            &tools,
        );
        let response = call_anthropic(state, config, &body).await?;
        session.tokens_used += response.usage.total();

        // Work out what she will be told BEFORE the turn is recorded, because
        // a turn that produced nothing cannot be recorded as itself. `Some`
        // means this iteration ends the turn; `None` means tools were asked
        // for and the loop goes round again.
        let tool_uses = response.tool_uses();
        let ending: Option<String> = if response.is_refusal() {
            Some(REFUSAL_MESSAGE.to_string())
        } else if tool_uses.is_empty() {
            let text = response.text();
            Some(if text.is_empty() {
                TANGLED_MESSAGE.to_string()
            } else {
                text
            })
        } else {
            None
        };

        // Echoed back unchanged on the next iteration — thinking blocks and
        // any block type this code does not know about included — EXCEPT for
        // a turn that cannot be replayed as itself, which is recorded as the
        // words she was actually shown.
        //
        // Two ways that happens, and both would poison the conversation for
        // good if stored verbatim — every later turn replays the transcript,
        // gets a 400 back and shows her "the helper could not answer" until
        // she starts again:
        //
        // - A refusal whose classifier fires before any output is an HTTP 200
        //   with an EMPTY `content` array, and the Messages API rejects a
        //   message with empty content.
        // - A refusal that fires MID-STREAM keeps whatever the model had
        //   finished, which can include a completed `tool_use` block. The
        //   turn ends there, so nothing answers that call, and the API
        //   rejects a `tool_use` that is not followed by its `tool_result`.
        //
        // A refusal is therefore never kept verbatim. Its text is the
        // classifier's, not the model's answer, and there is nothing in it
        // worth replaying.
        let replayable = response.has_content() && !response.is_refusal();
        session
            .api_messages
            .push(ApiMessage::assistant(if replayable {
                response.content.clone()
            } else {
                spoken(ending.as_deref().unwrap_or(TANGLED_MESSAGE))
            }));

        if let Some(text) = ending {
            reply = Some(text);
            break;
        }

        // Every call is answered, in the same user message, whether or not
        // the tool exists — an unanswered `tool_use` is a 400 on the next
        // request, and reading the repo is still a later slice.
        let mut results: Vec<Value> = vec![];
        for tool in &tool_uses {
            let answer = if tool.name == PROPOSE_ISSUE_TOOL {
                match IssueDraft::from_input(&tool.input, context) {
                    Some(draft) => {
                        tracing::info!("assistant drafted an issue: {}", draft.title);
                        session.pending_draft = Some(draft);
                        (false, DRAFT_ON_SCREEN)
                    }
                    None => {
                        tracing::warn!("assistant sent an incomplete issue draft");
                        (true, DRAFT_INCOMPLETE)
                    }
                }
            } else {
                tracing::info!("assistant asked for an unavailable tool: {}", tool.name);
                (true, no_such_tool(can_file))
            };
            results.push(json!({
                "type": "tool_result",
                "tool_use_id": tool.id,
                "is_error": answer.0,
                "content": answer.1,
            }));
        }
        session.api_messages.push(ApiMessage::user(json!(results)));
    }

    // A turn that used up every iteration stops mid-exchange: the last thing
    // recorded is the user-role `tool_result`s nobody answered. Left that way
    // the next message would follow one user turn with another, the Messages
    // API rejects that with a 400, and this conversation would be broken for
    // good — the same permanent poisoning an empty `content` would cause
    // above. Closing the turn with the words she is shown keeps the stored
    // transcript replayable and honest about where it stopped.
    let reply = reply.unwrap_or_else(|| {
        tracing::warn!("assistant turn exhausted its tool iterations");
        session
            .api_messages
            .push(ApiMessage::assistant(spoken(TANGLED_MESSAGE)));
        TANGLED_MESSAGE.to_string()
    });

    session.display.push(DisplayMessage::assistant(reply));
    session.turns += 1;
    save_session(store, &session).await?;
    Ok(session)
}

/// Her decision about the draft on screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DraftDecision {
    File,
    Dismiss,
}

/// GitHub rejects an issue body over 65,536 bytes. A 40-turn conversation
/// can get there, and losing the whole filing to a long chat would be a
/// poor trade — so the transcript is trimmed to fit under a margin instead.
const MAX_ISSUE_BODY_BYTES: usize = 60_000;

/// Act on the draft: file it, or let it go.
///
/// This is the confirmation step, and it is structural rather than
/// prompted. The model's tool only ever stores a draft; the GitHub issue is
/// created HERE, from a request the admin makes when Kari presses the
/// button. The transcript and the page context are composed in at this
/// point too, so neither can be left out by a model that decided to.
pub async fn decide_on_draft(
    state: &Arc<AssistantState>,
    store: &dyn ObjectStore,
    session_id: &str,
    decision: DraftDecision,
) -> Result<AssistantSession, AppError> {
    // Filing has its own configuration check — a host can talk without a
    // GitHub token. Dismissing deliberately has none: clearing a card she
    // does not want must work on any host, whatever happened to the token
    // since the draft was written.
    let github = match decision {
        DraftDecision::File => Some(state.github()?),
        DraftDecision::Dismiss => None,
    };

    // Taken before the session is read, so this either waits out a turn
    // already in flight or makes that turn wait — never both at once on
    // the same conversation. Waiting is the right answer rather than a
    // "try again": she pressed a button and the filing must happen, and
    // reading after the turn means filing whatever the card actually
    // shows once it settles.
    let lock = state.session_lock(session_id).await;
    let _write = lock.lock().await;

    let mut session = load_session(store, session_id).await?;
    // Taken, not borrowed: whichever way this goes the card leaves her
    // screen. The one exception is a failed filing, which returns before
    // the session is written, so the stored draft survives for a retry.
    let draft = session
        .pending_draft
        .take()
        .ok_or(AppError::BadRequest(NOTHING_TO_FILE_MESSAGE))?;

    let Some(github) = github else {
        session.pending_notes.push(format!(
            "She read the {} you drafted (\"{}\") and chose not to file it. \
Do not draft it again unless she asks. Carry on as normal.",
            draft.described(),
            draft.title
        ));
        save_session(store, &session).await?;
        return Ok(session);
    };

    let body = issue_body(&draft, &session);
    let created = github_issues::create_issue(
        &state.github_http,
        github,
        &draft.title,
        &body,
        &[USER_FEEDBACK_LABEL],
    )
    .await
    .map_err(|e| {
        match &e {
            // Nothing is wrong with what we sent; trying again may well
            // work, and the draft is still on the session for exactly that.
            GithubError::Busy(_) | GithubError::Transport(_) => {
                tracing::warn!("could not file an issue right now: {e}")
            }
            // A bad or expired token, or a label that no longer exists.
            // Worth a real log line: only the maintainer can fix it.
            _ => tracing::error!("filing an issue failed: {e}"),
        }
        // The same 503 either way. She cannot tell the two apart and
        // neither changes what she does next, so one calm message serves
        // both — the detail is in the log above.
        AppError::Unavailable(FILING_FAILED_MESSAGE)
    })?;

    let issue = FiledIssue {
        number: created.number,
        url: created.html_url,
        title: draft.title.clone(),
    };
    let number = issue.number;
    tracing::info!("filed issue #{number} from the admin helper");
    session.pending_notes.push(format!(
        "She filed the {} you drafted as issue #{}. She has already been \
shown a line saying it is filed, with a link, so there is no need to \
mention it again unless she does.",
        draft.described(),
        number
    ));
    session.filed_issues.push(issue.clone());
    session.display.push(DisplayMessage::filed(issue));
    // The issue exists whether or not this write lands, so a failed write
    // must NOT be reported as a failed filing. Every failure this route
    // returns is read by the panel as "the draft is still here, press again
    // in a moment" — true of the GitHub failures above, which return before
    // anything is created, and actively harmful here: the stored session
    // still holds the draft, so the second press would file a SECOND issue.
    // That is the outcome the one-writer lock exists to prevent, reached by
    // the other road.
    //
    // So the answer is the conversation as it truly now is: the card gone,
    // the filed line and its link in the transcript, and no button left
    // that could duplicate the issue. What is lost is durability alone —
    // the stored copy is the one from before the decision, so a reload can
    // bring the card back — which is why this is an `error!` the maintainer
    // can act on, with the issue number in it.
    if save_session(store, &session).await.is_err() {
        // `save_session` has already logged why; this line is the part that
        // needs the issue number beside it.
        tracing::error!(
            "issue #{number} was filed but the conversation could not be saved: the stored \
copy still holds the draft, so a reload will show the card again"
        );
    }
    Ok(session)
}

/// Compose what the issue actually says.
///
/// The model's `body` leads, because it is the part written to be read
/// first. Everything after it is added here rather than asked of the model:
/// the sentence she approved, the page she was on, the commit the site is
/// running, and the whole conversation.
fn issue_body(draft: &IssueDraft, session: &AssistantSession) -> String {
    let mut context = draft.context.lines();
    context.push(format!(
        "Site version: {}",
        crate::routes::version::COMMIT_SHA.unwrap_or("unknown")
    ));
    let context = context
        .iter()
        .map(|line| format!("- {line}\n"))
        .collect::<String>();

    let head = format!(
        "{}\n\n## What Kari was shown\n\n{}\n\n## Context\n\n{context}\n## \
Conversation\n\n",
        draft.body.trim(),
        draft.summary.trim(),
    );
    let foot = format!(
        "\n---\n\nFiled by Kari through the helper in her admin workshop, \
from the conversation above. Labelled `{USER_FEEDBACK_LABEL}`: the issue \
pipeline picks this up as product work ahead of its own backlog.\n"
    );

    let room = MAX_ISSUE_BODY_BYTES.saturating_sub(head.len() + foot.len());
    format!("{head}{}{foot}", transcript(&session.display, room))
}

/// The conversation as markdown, newest-first-priority.
///
/// Trimmed from the FRONT when it will not fit: the end of a conversation
/// is the part that led to the draft, and an issue that says where it was
/// cut is honest about it.
fn transcript(messages: &[DisplayMessage], room: usize) -> String {
    let omitted = "_(the earlier part of this conversation was too long to \
include)_\n\n";
    let mut kept: Vec<String> = vec![];
    let mut used = 0;
    // Whole messages only, from the end backwards — never split one, which
    // also means never splitting a character.
    for message in messages.iter().rev() {
        let who = if message.role == "user" {
            "Kari"
        } else {
            "Helper"
        };
        let line = format!("**{who}:** {}\n\n", message.text.trim());
        if used + line.len() > room.saturating_sub(omitted.len()) {
            kept.push(omitted.to_string());
            break;
        }
        used += line.len();
        kept.push(line);
    }
    kept.reverse();
    kept.concat()
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
