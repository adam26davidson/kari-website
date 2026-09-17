//! Shared harness for the admin-helper tests.
//!
//! Both helper test binaries (`assistant_tests.rs`, `assistant_issue_tests.rs`)
//! drive the REAL router with an in-memory `ObjectStore` and local axum stubs
//! standing in for the services it talks to. The stub is the
//! `jwks_refresh_tests.rs` pattern: bind `127.0.0.1:0`, serve scripted
//! replies, record what was asked. `ANTHROPIC_BASE_URL` and
//! `GITHUB_API_BASE_URL` are configuration precisely so this works — no HTTP
//! mocking crate is needed, and the code under test is the code that ships.
//!
//! Nothing here reads or writes an environment variable. Configuration is
//! injected through `AssistantState::new`, which keeps cases isolated from
//! each other under parallel test threads.
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    Json, Router,
};
use http_body_util::BodyExt;
use kari_website_api::routes::create_router;
use kari_website_api::services::anthropic::AnthropicConfig;
use kari_website_api::services::assistant::{AssistantLimits, AssistantState};
use kari_website_api::services::github_issues::GithubIssuesConfig;
use kari_website_api::services::object_store::ObjectStore;
use serde_json::{json, Value};
use tower::ServiceExt;

use super::store::{state_with_store_and_assistant, InMemoryStore};
use super::{build_jwks, signed_token, TokenOptions};

/// A session id that is a real uuid but was never created.
pub const ABSENT_SESSION: &str = "11111111-2222-3333-4444-555555555555";

// ---------------------------------------------------------------- the stub

/// One request the stub received.
pub struct SeenRequest {
    /// The path it was sent to — how a test tells `/v1/messages` from
    /// `/repos/owner/repo/issues`.
    pub path: String,
    pub body: Value,
    pub headers: HashMap<String, String>,
}

/// What the stub answers with, and what it was asked.
pub struct Stub {
    seen: Arc<Mutex<Vec<SeenRequest>>>,
    calls: Arc<AtomicUsize>,
    pub base_url: String,
}

/// Serve `replies` in order from a local stand-in for an HTTP service. The
/// LAST reply repeats once the script runs out, so a test that only cares
/// about the first call does not have to pad the list.
///
/// A catch-all route rather than a fixed path: the same stub then stands in
/// for Anthropic and for GitHub, and a test can assert WHICH path the code
/// under test chose — which is half of what these tests are checking.
pub async fn spawn_stub(replies: Vec<(StatusCode, Value)>) -> Stub {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let calls = Arc::new(AtomicUsize::new(0));
    let replies = Arc::new(replies);

    let handler_seen = seen.clone();
    let handler_calls = calls.clone();
    let app = Router::new().fallback(move |request: Request<Body>| {
        let seen = handler_seen.clone();
        let calls = handler_calls.clone();
        let replies = replies.clone();
        async move {
            let path = request.uri().path().to_string();
            let headers = request
                .headers()
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_string(),
                        value.to_str().unwrap_or_default().to_string(),
                    )
                })
                .collect();
            let bytes = request
                .into_body()
                .collect()
                .await
                .expect("stub read body")
                .to_bytes();
            let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            seen.lock().unwrap().push(SeenRequest {
                path,
                body,
                headers,
            });
            let n = calls.fetch_add(1, Ordering::SeqCst);
            let (status, reply) = replies[n.min(replies.len() - 1)].clone();
            (status, Json(reply))
        }
    });

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind stub");
    let addr = listener.local_addr().expect("local addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve stub");
    });

    Stub {
        seen,
        calls,
        base_url: format!("http://{addr}"),
    }
}

impl Stub {
    /// The request bodies, in order — what most assertions are about.
    pub fn requests(&self) -> Vec<Value> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .map(|seen| seen.body.clone())
            .collect()
    }

    /// The paths asked for, in order.
    pub fn paths(&self) -> Vec<String> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .map(|seen| seen.path.clone())
            .collect()
    }

    /// One header from the nth request, lower-cased name.
    pub fn header(&self, n: usize, name: &str) -> Option<String> {
        self.seen
            .lock()
            .unwrap()
            .get(n)
            .and_then(|seen| seen.headers.get(name).cloned())
    }

    pub fn call_count(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

/// A plain text reply, as the model sends when it has nothing to ask for.
pub fn text_reply(text: &str) -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({
            "content": [{"type": "text", "text": text}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 100, "output_tokens": 20},
        }),
    )
}

/// A reply asking for a tool, with whatever input the test wants.
pub fn tool_call_reply(name: &str, input: Value) -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({
            "content": [
                {"type": "text", "text": "Let me look."},
                {"type": "tool_use", "id": "toolu_1", "name": name, "input": input},
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 100, "output_tokens": 20},
        }),
    )
}

/// A reply asking for a tool the helper does not have.
pub fn tool_reply(name: &str) -> (StatusCode, Value) {
    tool_call_reply(name, json!({"q": "x"}))
}

// ------------------------------------------------------------ app assembly

/// The Anthropic half of the configuration, pointed at a stub.
pub fn anthropic_config(base_url: &str) -> AnthropicConfig {
    AnthropicConfig {
        api_key: "test-key".to_string(),
        base_url: base_url.to_string(),
        model: "claude-opus-5".to_string(),
        effort: "medium".to_string(),
        max_tokens: 8192,
        fallbacks: Some("default".to_string()),
    }
}

/// The filing half of the configuration, pointed at a stub.
pub fn github_config(base_url: &str) -> GithubIssuesConfig {
    GithubIssuesConfig {
        token: "test-github-token".to_string(),
        base_url: base_url.to_string(),
        repo: "adam26davidson/kari-website".to_string(),
    }
}

/// A helper that can talk to `base_url` but cannot file anything — the
/// state slice 1 shipped in, and the state of a host with no GitHub token.
pub fn configured(base_url: &str, limits: AssistantLimits) -> AssistantState {
    AssistantState::new(Some(anthropic_config(base_url)), limits)
}

/// An app whose helper is configured against `stub` and cannot file.
pub fn app_with(stub: &Stub, limits: AssistantLimits) -> (Arc<InMemoryStore>, Router) {
    app_from(configured(&stub.base_url, limits))
}

/// An app around an explicitly built helper.
pub fn app_from(assistant: AssistantState) -> (Arc<InMemoryStore>, Router) {
    let store = Arc::new(InMemoryStore::default());
    let app = app_from_store(store.clone(), assistant);
    (store, app)
}

/// An app over an EXISTING store — how a test changes the configuration
/// while keeping the conversations already written, which is what a host
/// losing (or gaining) a secret looks like from a session's point of view.
pub fn app_from_store(store: Arc<InMemoryStore>, assistant: AssistantState) -> Router {
    create_router(state_with_store_and_assistant(
        build_jwks(),
        store,
        assistant,
    ))
}

/// An app whose helper has no API key — a host that has never been given
/// the secret, which is the state this feature ships in.
pub fn resting_app() -> (Arc<InMemoryStore>, Router) {
    app_from(AssistantState::default())
}

// ------------------------------------------------------------- requesting

pub fn bearer() -> String {
    format!("Bearer {}", signed_token(TokenOptions::default()))
}

pub fn get_auth(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .body(Body::empty())
        .unwrap()
}

pub fn post_auth(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

pub async fn send(app: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

/// Start a conversation and return its id.
pub async fn new_session(app: &Router) -> String {
    let (status, body) = send(app, post_auth("/assistant/sessions", json!({}))).await;
    assert_eq!(status, StatusCode::OK, "creating a session: {body}");
    body["id"].as_str().expect("session id").to_string()
}

/// Send one message as Kari and return the reply.
pub async fn say(app: &Router, id: &str, text: &str) -> (StatusCode, Value) {
    send(
        app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": text}),
        ),
    )
    .await
}

/// Every session object written to the store.
pub async fn stored_sessions(store: &InMemoryStore) -> Vec<String> {
    store
        .list_objects("assistant/")
        .await
        .expect("list sessions")
        .into_iter()
        .map(|meta| meta.key)
        .collect()
}

/// The text of the last message in a session view.
pub fn last_message(body: &Value) -> String {
    let messages = body["messages"].as_array().expect("messages");
    messages
        .last()
        .and_then(|m| m["text"].as_str())
        .unwrap_or_default()
        .to_string()
}
