//! Filing a GitHub issue, on Kari's behalf and only when she says so.
//!
//! One call — `POST /repos/{owner}/{repo}/issues` — spoken directly over
//! `reqwest`, the same shape as `anthropic.rs`. There is no GitHub SDK in
//! this crate and one endpoint does not warrant one.
//!
//! The token is a fine-grained PAT scoped to this repository's issues and
//! nothing else, read from the environment at startup. As with the helper
//! itself the whole thing is optional: with no `GITHUB_ISSUES_TOKEN` the
//! feature reports itself unavailable, the conversation carries on, and
//! nothing else in the API notices.

use std::time::Duration;

use serde::Deserialize;
use serde_json::json;

pub const DEFAULT_BASE_URL: &str = "https://api.github.com";

/// Where issues are filed when the host does not say otherwise. This is
/// the repository the admin itself is built from, which is the only one
/// the token is ever scoped to.
pub const DEFAULT_REPO: &str = "adam26davidson/kari-website";

/// The REST API version header value. Pinned rather than configurable, for
/// the same reason as Anthropic's: a different version is a different wire
/// format, which is a code change.
pub const API_VERSION: &str = "2022-11-28";

/// GitHub rejects a request with no user agent, so this is not decoration.
pub const USER_AGENT: &str = "kari-website-api";

/// Filing is one small POST — nothing like an Opus turn — so a short
/// timeout is right: she is waiting on a button.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Everything needed to file an issue, read once at startup.
///
/// As with `AnthropicConfig` there is no `Default`: the absence of a config
/// IS the unconfigured state, held as `Option<GithubIssuesConfig>` by the
/// caller, so "no token" is one well-typed condition.
#[derive(Clone, Debug)]
pub struct GithubIssuesConfig {
    pub token: String,
    pub base_url: String,
    /// `owner/repo`.
    pub repo: String,
}

/// Read `var`, treating unset and blank alike as absent — a host with
/// `GITHUB_ISSUES_TOKEN=` should degrade to "filing unavailable", not send
/// an empty credential and get a 401 in front of her.
fn env_opt(var: &str) -> Option<String> {
    std::env::var(var)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

impl GithubIssuesConfig {
    /// Build from the environment, or `None` when there is no token.
    pub fn from_env() -> Option<Self> {
        let token = env_opt("GITHUB_ISSUES_TOKEN")?;
        Some(Self {
            token,
            base_url: env_opt("GITHUB_API_BASE_URL")
                .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
                .trim_end_matches('/')
                .to_string(),
            repo: env_opt("GITHUB_ISSUES_REPO").unwrap_or_else(|| DEFAULT_REPO.to_string()),
        })
    }
}

/// A filed issue, as the admin shows it: a number and somewhere to click.
#[derive(Clone, Debug, Deserialize)]
pub struct CreatedIssue {
    pub number: u64,
    pub html_url: String,
}

#[derive(Debug)]
pub enum GithubError {
    /// The request never completed (DNS, connect, timeout).
    Transport(String),
    /// Rate limited or a 5xx — worth trying again.
    Busy(String),
    /// A 4xx: a bad or expired token, a missing label, a repo the token
    /// cannot see. Nothing a retry fixes.
    Rejected(String),
    /// A 2xx whose body did not parse as an issue.
    Decode(String),
}

impl std::fmt::Display for GithubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GithubError::Transport(e) => write!(f, "github transport error: {e}"),
            GithubError::Busy(e) => write!(f, "github unavailable: {e}"),
            GithubError::Rejected(e) => write!(f, "github rejected the request: {e}"),
            GithubError::Decode(e) => write!(f, "github response could not be read: {e}"),
        }
    }
}

impl std::error::Error for GithubError {}

/// File one issue and return its number and url.
pub async fn create_issue(
    http: &reqwest::Client,
    config: &GithubIssuesConfig,
    title: &str,
    body: &str,
    labels: &[&str],
) -> Result<CreatedIssue, GithubError> {
    let url = format!("{}/repos/{}/issues", config.base_url, config.repo);
    let response = http
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.token))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .header("User-Agent", USER_AGENT)
        .json(&json!({"title": title, "body": body, "labels": labels}))
        .send()
        .await
        .map_err(|e| GithubError::Transport(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        // GitHub's own words go to the log, never to the browser.
        let detail = response.text().await.unwrap_or_default();
        let detail = format!("{status}: {}", detail.chars().take(500).collect::<String>());
        return Err(if status.as_u16() == 429 || status.is_server_error() {
            GithubError::Busy(detail)
        } else {
            GithubError::Rejected(detail)
        });
    }

    response
        .json::<CreatedIssue>()
        .await
        .map_err(|e| GithubError::Decode(e.to_string()))
}
