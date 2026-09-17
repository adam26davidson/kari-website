//! Tests for the admin helper, driven through the REAL router (auth layer
//! included) with an in-memory `ObjectStore` and a local axum stub standing
//! in for Anthropic.
//!
//! The stub is the `jwks_refresh_tests.rs` pattern: bind `127.0.0.1:0`,
//! serve scripted replies, record what was asked. `ANTHROPIC_BASE_URL` is
//! config precisely so this works — no HTTP mocking crate is needed, and
//! the code under test is the same code that ships.
//!
//! Nothing here reads or writes an environment variable. The assistant's
//! configuration is injected through `AssistantState::new`, which keeps
//! these cases isolated from each other under parallel test threads.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    routing::post,
    Json, Router,
};
use common::store::{state_with_store, state_with_store_and_assistant, InMemoryStore};
use common::{build_jwks, capture_tracing, signed_token, TokenOptions};
use http_body_util::BodyExt;
use kari_website_api::routes::create_router;
use kari_website_api::services::anthropic::AnthropicConfig;
use kari_website_api::services::assistant::{
    session_key, AssistantLimits, AssistantState, ENOUGH_FOR_NOW_MESSAGE, REFUSAL_MESSAGE,
    RESTING_MESSAGE, TANGLED_MESSAGE,
};
use kari_website_api::services::object_store::ObjectStore;
use serde_json::{json, Value};
use tower::ServiceExt;

/// A session id that is a real uuid but was never created.
const ABSENT_SESSION: &str = "11111111-2222-3333-4444-555555555555";

// ---------------------------------------------------------------- the stub

/// What the stub Anthropic answers with, and what it was asked.
struct Stub {
    /// Request bodies received, in order.
    seen: Arc<Mutex<Vec<Value>>>,
    calls: Arc<AtomicUsize>,
    base_url: String,
}

/// Serve `replies` in order from a local Anthropic stand-in. The LAST reply
/// repeats once the script runs out, so a test that only cares about the
/// first call does not have to pad the list.
async fn spawn_anthropic(replies: Vec<(StatusCode, Value)>) -> Stub {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let calls = Arc::new(AtomicUsize::new(0));
    let replies = Arc::new(replies);

    let handler_seen = seen.clone();
    let handler_calls = calls.clone();
    let app = Router::new().route(
        "/v1/messages",
        post(move |Json(body): Json<Value>| {
            let seen = handler_seen.clone();
            let calls = handler_calls.clone();
            let replies = replies.clone();
            async move {
                seen.lock().unwrap().push(body);
                let n = calls.fetch_add(1, Ordering::SeqCst);
                let (status, reply) = replies[n.min(replies.len() - 1)].clone();
                (status, Json(reply))
            }
        }),
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind stub anthropic");
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
    fn requests(&self) -> Vec<Value> {
        self.seen.lock().unwrap().clone()
    }

    fn call_count(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

/// A plain text reply, as the model sends when it has nothing to ask for.
fn text_reply(text: &str) -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({
            "content": [{"type": "text", "text": text}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 100, "output_tokens": 20},
        }),
    )
}

/// A reply asking for a tool the helper does not have.
fn tool_reply(name: &str) -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({
            "content": [
                {"type": "text", "text": "Let me look."},
                {"type": "tool_use", "id": "toolu_1", "name": name, "input": {"q": "x"}},
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 100, "output_tokens": 20},
        }),
    )
}

// ------------------------------------------------------------ app assembly

fn configured(base_url: &str, limits: AssistantLimits) -> AssistantState {
    AssistantState::new(
        Some(AnthropicConfig {
            api_key: "test-key".to_string(),
            base_url: base_url.to_string(),
            model: "claude-opus-5".to_string(),
            effort: "medium".to_string(),
            max_tokens: 8192,
            fallbacks: Some("default".to_string()),
        }),
        limits,
    )
}

/// An app whose helper is configured against `stub`.
fn app_with(stub: &Stub, limits: AssistantLimits) -> (Arc<InMemoryStore>, Router) {
    let store = Arc::new(InMemoryStore::default());
    let app = create_router(state_with_store_and_assistant(
        build_jwks(),
        store.clone(),
        configured(&stub.base_url, limits),
    ));
    (store, app)
}

/// An app whose helper has no API key — a host that has never been given
/// the secret, which is the state this feature ships in.
fn resting_app() -> (Arc<InMemoryStore>, Router) {
    let store = Arc::new(InMemoryStore::default());
    let app = create_router(state_with_store(build_jwks(), store.clone()));
    (store, app)
}

fn bearer() -> String {
    format!("Bearer {}", signed_token(TokenOptions::default()))
}

fn get_auth(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .body(Body::empty())
        .unwrap()
}

fn post_auth(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn send(app: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

/// Start a conversation and return its id.
async fn new_session(app: &Router) -> String {
    let (status, body) = send(app, post_auth("/assistant/sessions", json!({}))).await;
    assert_eq!(status, StatusCode::OK, "creating a session: {body}");
    body["id"].as_str().expect("session id").to_string()
}

/// Every session object written to the store.
async fn stored_sessions(store: &InMemoryStore) -> Vec<String> {
    store
        .list_objects("assistant/")
        .await
        .expect("list sessions")
        .into_iter()
        .map(|meta| meta.key)
        .collect()
}

/// The text of the last message in a session view.
fn last_message(body: &Value) -> String {
    let messages = body["messages"].as_array().expect("messages");
    messages
        .last()
        .and_then(|m| m["text"].as_str())
        .unwrap_or_default()
        .to_string()
}

// ------------------------------------------------------------------- tests

#[tokio::test]
async fn every_assistant_route_needs_a_token() {
    let (_, app) = resting_app();
    let unauthenticated = [
        Request::builder()
            .uri("/assistant/status")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/assistant/sessions")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .uri(format!("/assistant/sessions/{ABSENT_SESSION}"))
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri(format!("/assistant/sessions/{ABSENT_SESSION}/messages"))
            .body(Body::empty())
            .unwrap(),
    ];
    for request in unauthenticated {
        let uri = request.uri().to_string();
        let status = app.clone().oneshot(request).await.unwrap().status();
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri} must require auth");
    }
}

#[tokio::test]
async fn status_says_the_helper_is_unavailable_without_an_api_key() {
    let (_, app) = resting_app();
    // 200, not 503: this is the route the admin asks BEFORE deciding what to
    // show, so it has to answer even when everything else refuses.
    let (status, body) = send(&app, get_auth("/assistant/status")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"available": false, "canFile": false}));
}

#[tokio::test]
async fn status_says_the_helper_is_available_once_configured() {
    let stub = spawn_anthropic(vec![text_reply("hello")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let (status, body) = send(&app, get_auth("/assistant/status")).await;
    assert_eq!(status, StatusCode::OK);
    // `canFile` stays false until filing ships; the admin uses it to decide
    // whether to offer that at all.
    assert_eq!(body, json!({"available": true, "canFile": false}));
    // Nothing was asked of the model just to report status.
    assert_eq!(stub.call_count(), 0);
}

#[tokio::test]
async fn the_conversation_routes_rest_without_an_api_key() {
    let _trace = capture_tracing();
    let (store, app) = resting_app();

    for request in [
        post_auth("/assistant/sessions", json!({})),
        get_auth(&format!("/assistant/sessions/{ABSENT_SESSION}")),
        post_auth(
            &format!("/assistant/sessions/{ABSENT_SESSION}/messages"),
            json!({"text": "hello"}),
        ),
    ] {
        let uri = request.uri().to_string();
        let (status, body) = send(&app, request).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
        // The friendly words come from the API, so the admin and the server
        // cannot drift into saying different things.
        assert_eq!(body, json!({"error": RESTING_MESSAGE}), "{uri}");
    }

    // An unconfigured host must not accumulate empty session objects.
    assert!(stored_sessions(&store).await.is_empty());
}

#[tokio::test]
async fn a_message_gets_a_reply_and_the_conversation_is_stored() {
    let stub = spawn_anthropic(vec![text_reply(
        "Open Haiku in the menu, then Add a haiku.",
    )])
    .await;
    let (store, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    let (status, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "How do I add a haiku?"}),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["messages"],
        json!([
            {"role": "user", "text": "How do I add a haiku?"},
            {"role": "assistant", "text": "Open Haiku in the menu, then Add a haiku."},
        ])
    );

    // The transcript is on S3, which is what lets a reload pick it back up.
    let stored = store.get(&session_key(&id)).expect("session object");
    assert!(!stored.public, "conversations must never be world-readable");
    let session: Value = serde_json::from_slice(&stored.data).unwrap();
    assert_eq!(session["turns"], 1);
    assert_eq!(session["display"].as_array().unwrap().len(), 2);
    // Usage is accumulated so the session ceiling has something to measure.
    assert_eq!(session["tokensUsed"], 120);
}

#[tokio::test]
async fn a_reloaded_conversation_comes_back() {
    let stub = spawn_anthropic(vec![text_reply("Of course.")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;
    send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "Hello"}),
        ),
    )
    .await;

    let (status, body) = send(&app, get_auth(&format!("/assistant/sessions/{id}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(last_message(&body), "Of course.");
    assert_eq!(body["id"], id);
}

#[tokio::test]
async fn the_second_message_carries_the_conversation_so_far() {
    let stub = spawn_anthropic(vec![text_reply("First."), text_reply("Second.")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    for text in ["One", "Two"] {
        send(
            &app,
            post_auth(
                &format!("/assistant/sessions/{id}/messages"),
                json!({"text": text}),
            ),
        )
        .await;
    }

    let requests = stub.requests();
    assert_eq!(requests.len(), 2);
    // The whole exchange is replayed: her first message, the model's answer,
    // then her second. Without this the helper would forget every turn.
    let second = requests[1]["messages"].as_array().unwrap();
    assert_eq!(second.len(), 3);
    assert_eq!(second[0]["role"], "user");
    assert!(second[0]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("One"));
    assert_eq!(second[1]["role"], "assistant");
    assert_eq!(second[1]["content"][0]["text"], "First.");
    assert!(second[2]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("Two"));
}

#[tokio::test]
async fn what_she_is_looking_at_reaches_the_model() {
    let stub = spawn_anthropic(vec![text_reply("Save it with the button at the top.")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({
                "text": "What do I do now?",
                "context": {
                    "route": "/haiku/seed-haiku-1",
                    "what": "haiku",
                    "id": "seed-haiku-1",
                    "title": "Autumn rain",
                    "dirty": true,
                },
            }),
        ),
    )
    .await;

    let sent = stub.requests()[0]["messages"][0]["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(sent.contains("/haiku/seed-haiku-1"), "{sent}");
    assert!(sent.contains("Autumn rain"), "{sent}");
    assert!(sent.contains("unsaved changes"), "{sent}");
    // Her actual words survive the context preamble.
    assert!(sent.contains("What do I do now?"), "{sent}");
}

#[tokio::test]
async fn the_transcript_she_reads_holds_only_her_words() {
    let stub = spawn_anthropic(vec![text_reply("Sure.")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    let (_, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "Help", "context": {"route": "/haiku"}}),
        ),
    )
    .await;

    // The page context is for the model, not for her — it must not appear
    // in the panel as though she had typed it.
    assert_eq!(body["messages"][0]["text"], "Help");
}

#[tokio::test]
async fn a_tool_request_is_answered_and_the_turn_carries_on() {
    let _trace = capture_tracing();
    let stub = spawn_anthropic(vec![
        tool_reply("search_repo"),
        text_reply("I can't look that up yet, but here's what I know."),
    ])
    .await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    let (status, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "What does the home page show?"}),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        last_message(&body),
        "I can't look that up yet, but here's what I know."
    );

    // The second call carried a tool_result answering the first call's id —
    // the plumbing later slices hang real tools on.
    let second = stub.requests()[1]["messages"].as_array().unwrap().clone();
    let result = &second[second.len() - 1]["content"][0];
    assert_eq!(result["type"], "tool_result");
    assert_eq!(result["tool_use_id"], "toolu_1");
    assert_eq!(result["is_error"], true);
}

#[tokio::test]
async fn a_model_that_only_asks_for_tools_gives_up_kindly() {
    let _trace = capture_tracing();
    // The stub never stops asking for a tool, so the turn runs out of room.
    let stub = spawn_anthropic(vec![tool_reply("search_repo")]).await;
    let limits = AssistantLimits {
        max_tool_iterations_per_turn: 3,
        ..AssistantLimits::default()
    };
    let (_, app) = app_with(&stub, limits);
    let id = new_session(&app).await;

    let (status, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "Anything"}),
        ),
    )
    .await;

    // Not a 500 — she gets a sentence she can act on, and the cap held.
    assert_eq!(status, StatusCode::OK);
    assert_eq!(last_message(&body), TANGLED_MESSAGE);
    assert_eq!(stub.call_count(), 3, "the iteration cap must hold");
}

#[tokio::test]
async fn an_exhausted_tool_loop_does_not_poison_the_conversation() {
    let _trace = capture_tracing();
    // Three tool requests use the whole cap, so the first turn ends on
    // unanswered tool_results; the fourth reply serves her NEXT message.
    let stub = spawn_anthropic(vec![
        tool_reply("search_repo"),
        tool_reply("search_repo"),
        tool_reply("search_repo"),
        text_reply("Of course, gladly."),
    ])
    .await;
    let limits = AssistantLimits {
        max_tool_iterations_per_turn: 3,
        ..AssistantLimits::default()
    };
    let (_, app) = app_with(&stub, limits);
    let id = new_session(&app).await;

    let mut last = Value::Null;
    for text in ["Anything", "Something ordinary"] {
        let (status, body) = send(
            &app,
            post_auth(
                &format!("/assistant/sessions/{id}/messages"),
                json!({"text": text}),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{text}");
        last = body;
    }
    assert_eq!(last_message(&last), "Of course, gladly.");

    // The exhausted turn was closed off with the words she was shown. Left
    // ending on its tool_results, the transcript would put two user-role
    // messages in a row, and the Messages API answers that with a 400 — so
    // every later message in this conversation would fail until she started
    // again.
    let replayed = stub.requests()[3]["messages"].as_array().unwrap().clone();
    assert_transcript_is_replayable(&replayed);
    // ...and the closing turn says what she was told, not nothing.
    let closing = &replayed[replayed.len() - 2];
    assert_eq!(closing["role"], "assistant");
    assert_eq!(closing["content"][0]["text"], TANGLED_MESSAGE);
}

/// A refusal whose classifier fired before any output: HTTP 200, an EMPTY
/// content array, and `stop_reason: "refusal"`.
fn refusal_reply() -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({
            "content": [],
            "stop_reason": "refusal",
            "usage": {"input_tokens": 10, "output_tokens": 0},
        }),
    )
}

/// A refusal whose classifier fired MID-STREAM, after the model had already
/// completed a `tool_use` block: HTTP 200, PARTIAL content, and
/// `stop_reason: "refusal"`.
fn partial_refusal_reply() -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({
            "content": [
                {"type": "text", "text": "Let me look."},
                {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "search_repo",
                    "input": {"q": "x"},
                },
            ],
            "stop_reason": "refusal",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }),
    )
}

#[tokio::test]
async fn a_declined_turn_becomes_a_friendly_message() {
    let stub = spawn_anthropic(vec![refusal_reply()]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    let (status, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "Something odd"}),
        ),
    )
    .await;

    // A refusal is an HTTP 200 with an empty answer; unhandled it would look
    // like a blank reply or a crash.
    assert_eq!(status, StatusCode::OK);
    assert_eq!(last_message(&body), REFUSAL_MESSAGE);
}

#[tokio::test]
async fn a_declined_turn_does_not_poison_the_conversation() {
    let stub = spawn_anthropic(vec![refusal_reply(), text_reply("Of course, gladly.")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    for text in ["Something odd", "Something ordinary"] {
        let (status, _) = send(
            &app,
            post_auth(
                &format!("/assistant/sessions/{id}/messages"),
                json!({"text": text}),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{text}");
    }

    // The refused turn was recorded as the words she was shown, NOT as the
    // model's empty content. An empty `content` is a 400 on the next request,
    // so replaying one verbatim would break every later message in this
    // conversation until she started again.
    let replayed = stub.requests()[1]["messages"].as_array().unwrap().clone();
    for message in &replayed {
        let blocks = message["content"].as_array().expect("content is an array");
        assert!(
            !blocks.is_empty(),
            "no replayed message may have empty content: {message}"
        );
    }
    assert_eq!(replayed[1]["role"], "assistant");
    assert_eq!(replayed[1]["content"][0]["text"], REFUSAL_MESSAGE);
}

#[tokio::test]
async fn a_declined_turn_with_partial_output_does_not_poison_the_conversation() {
    let stub = spawn_anthropic(vec![
        partial_refusal_reply(),
        text_reply("Of course, gladly."),
    ])
    .await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    let mut last = Value::Null;
    for text in ["Something odd", "Something ordinary"] {
        let (status, body) = send(
            &app,
            post_auth(
                &format!("/assistant/sessions/{id}/messages"),
                json!({"text": text}),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{text}");
        last = body;
    }
    assert_eq!(last_message(&last), "Of course, gladly.");

    // A refusal can arrive mid-stream, AFTER the model has completed a
    // `tool_use` block. The turn ends there, so nothing ever answers that
    // call: replayed verbatim the transcript's last assistant message holds a
    // `tool_use` with no `tool_result` after it, the Messages API answers
    // that with a 400, and every later message in this conversation fails
    // until she starts again.
    let replayed = stub.requests()[1]["messages"].as_array().unwrap().clone();
    assert_transcript_is_replayable(&replayed);
    assert_eq!(replayed[1]["role"], "assistant");
    assert_eq!(replayed[1]["content"][0]["text"], REFUSAL_MESSAGE);
}

/// Everything the Messages API insists on for a transcript it is asked to
/// continue: alternating roles, no empty content, and every `tool_use`
/// answered by a `tool_result` in the message immediately after it.
fn assert_transcript_is_replayable(messages: &[Value]) {
    let roles: Vec<&str> = messages
        .iter()
        .map(|m| m["role"].as_str().expect("role"))
        .collect();
    for (i, role) in roles.iter().enumerate() {
        let expected = if i % 2 == 0 { "user" } else { "assistant" };
        assert_eq!(role, &expected, "roles must alternate, got {roles:?}");
    }

    for (i, message) in messages.iter().enumerate() {
        let blocks = message["content"].as_array().expect("content is an array");
        assert!(
            !blocks.is_empty(),
            "no replayed message may have empty content: {message}"
        );
        let calls: Vec<&str> = blocks
            .iter()
            .filter(|b| b["type"] == "tool_use")
            .map(|b| b["id"].as_str().expect("tool_use id"))
            .collect();
        if calls.is_empty() {
            continue;
        }
        let answers: Vec<&str> = messages
            .get(i + 1)
            .and_then(|m| m["content"].as_array())
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b["type"] == "tool_result")
                    .filter_map(|b| b["tool_use_id"].as_str())
                    .collect()
            })
            .unwrap_or_default();
        for call in calls {
            assert!(
                answers.contains(&call),
                "tool_use {call} is never answered: {messages:#?}"
            );
        }
    }
}

#[tokio::test]
async fn an_empty_answer_still_says_something() {
    // A turn that ends with no text at all (all blocks filtered out) must
    // not render as an empty bubble.
    let stub = spawn_anthropic(vec![(
        StatusCode::OK,
        json!({
            "content": [{"type": "thinking", "thinking": ""}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 1},
        }),
    )])
    .await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    let (status, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "Hello"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(last_message(&body), TANGLED_MESSAGE);
}

#[tokio::test]
async fn a_busy_model_reads_as_resting() {
    let _trace = capture_tracing();
    for upstream in [
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::INTERNAL_SERVER_ERROR,
        StatusCode::from_u16(529).unwrap(), // Anthropic's "overloaded"
    ] {
        let stub = spawn_anthropic(vec![(upstream, json!({"error": "busy"}))]).await;
        let (_, app) = app_with(&stub, AssistantLimits::default());
        let id = new_session(&app).await;

        let (status, body) = send(
            &app,
            post_auth(
                &format!("/assistant/sessions/{id}/messages"),
                json!({"text": "Hello"}),
            ),
        )
        .await;

        // 503, not 500: nothing is broken here and she is told to try later.
        assert_eq!(
            status,
            StatusCode::SERVICE_UNAVAILABLE,
            "upstream {upstream}"
        );
        assert_eq!(body, json!({"error": RESTING_MESSAGE}));
    }
}

#[tokio::test]
async fn a_rejected_request_is_an_honest_error() {
    let _trace = capture_tracing();
    // A 400 is our fault (a bad request shape, a retired model), so it is a
    // real error rather than a "try later" — and Anthropic's wording never
    // reaches the browser.
    let stub = spawn_anthropic(vec![(
        StatusCode::BAD_REQUEST,
        json!({"error": {"message": "budget_tokens is not supported"}}),
    )])
    .await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    let (status, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "Hello"}),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "The helper could not answer"}));
}

#[tokio::test]
async fn a_long_conversation_stops_at_the_turn_cap() {
    let stub = spawn_anthropic(vec![text_reply("Yes.")]).await;
    let limits = AssistantLimits {
        max_turns_per_session: 1,
        ..AssistantLimits::default()
    };
    let (_, app) = app_with(&stub, limits);
    let id = new_session(&app).await;

    let first = post_auth(
        &format!("/assistant/sessions/{id}/messages"),
        json!({"text": "One"}),
    );
    let (status, body) = send(&app, first).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["turnsRemaining"], 0);

    let second = post_auth(
        &format!("/assistant/sessions/{id}/messages"),
        json!({"text": "Two"}),
    );
    let (status, body) = send(&app, second).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body, json!({"error": ENOUGH_FOR_NOW_MESSAGE}));
    assert_eq!(
        stub.call_count(),
        1,
        "the capped turn must not reach the model"
    );
}

#[tokio::test]
async fn an_expensive_conversation_stops_at_the_token_cap() {
    let stub = spawn_anthropic(vec![text_reply("Yes.")]).await;
    // One reply spends 120 tokens, so a 50-token ceiling is spent after it.
    let limits = AssistantLimits {
        max_session_tokens: 50,
        ..AssistantLimits::default()
    };
    let (_, app) = app_with(&stub, limits);
    let id = new_session(&app).await;

    send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "One"}),
        ),
    )
    .await;
    let (status, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "Two"}),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body, json!({"error": ENOUGH_FOR_NOW_MESSAGE}));
}

#[tokio::test]
async fn the_day_has_a_ceiling_of_its_own() {
    let _trace = capture_tracing();
    let stub = spawn_anthropic(vec![text_reply("Yes.")]).await;
    // Per-session caps do not bound a determined loop across many sessions;
    // this one does.
    let limits = AssistantLimits {
        daily_turn_limit: 1,
        ..AssistantLimits::default()
    };
    let (_, app) = app_with(&stub, limits);

    let first = new_session(&app).await;
    let (status, _) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{first}/messages"),
            json!({"text": "One"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // A brand new conversation does not reset the day's allowance.
    let second = new_session(&app).await;
    let (status, body) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{second}/messages"),
            json!({"text": "Two"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body, json!({"error": ENOUGH_FOR_NOW_MESSAGE}));
}

#[tokio::test]
async fn a_conversation_that_never_existed_is_not_found() {
    let stub = spawn_anthropic(vec![text_reply("Yes.")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());

    let (status, body) = send(
        &app,
        get_auth(&format!("/assistant/sessions/{ABSENT_SESSION}")),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({"error": "That conversation has ended"}));
}

#[tokio::test]
async fn a_session_id_can_never_be_a_path_into_the_bucket() {
    let stub = spawn_anthropic(vec![text_reply("Yes.")]).await;
    let (store, app) = app_with(&stub, AssistantLimits::default());
    // The one place a caller-supplied string reaches an S3 key. Without the
    // uuid check these would read and overwrite real site content.
    for id in ["..%2F..%2Fsite-settings", "site-settings", "a/../../haiku"] {
        let (status, _) = send(&app, get_auth(&format!("/assistant/sessions/{id}"))).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "id {id} must be refused");

        let (status, _) = send(
            &app,
            post_auth(
                &format!("/assistant/sessions/{id}/messages"),
                json!({"text": "Hello"}),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "id {id} must be refused");
    }
    assert_eq!(stub.call_count(), 0);
    assert!(stored_sessions(&store).await.is_empty());
}

#[tokio::test]
async fn a_corrupt_stored_conversation_is_a_hard_error() {
    let _trace = capture_tracing();
    let stub = spawn_anthropic(vec![text_reply("Yes.")]).await;
    let store =
        Arc::new(InMemoryStore::default().with_object(&session_key(ABSENT_SESSION), "{oops"));
    let app = create_router(state_with_store_and_assistant(
        build_jwks(),
        store,
        configured(&stub.base_url, AssistantLimits::default()),
    ));

    // Silently starting a fresh conversation would lose a transcript she may
    // be halfway through, and hide the fault. Same call as site settings.
    let (status, body) = send(
        &app,
        get_auth(&format!("/assistant/sessions/{ABSENT_SESSION}")),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Stored conversation is invalid"}));
}

#[tokio::test]
async fn an_empty_message_is_refused_before_it_costs_anything() {
    let stub = spawn_anthropic(vec![text_reply("Yes.")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;

    let (status, _) = send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "   "}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(stub.call_count(), 0);
}

#[tokio::test]
async fn the_request_matches_what_this_model_accepts() {
    // A drift guard. Opus 5 rejects `budget_tokens`, `temperature` and an
    // assistant prefill outright, and thinks adaptively when `thinking` is
    // omitted — so the shape of the request is a correctness property, not
    // a detail. Caching the system block is what keeps a resent transcript
    // affordable.
    let stub = spawn_anthropic(vec![text_reply("Yes.")]).await;
    let (_, app) = app_with(&stub, AssistantLimits::default());
    let id = new_session(&app).await;
    send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({"text": "Hello"}),
        ),
    )
    .await;

    let request = &stub.requests()[0];
    assert_eq!(request["model"], "claude-opus-5");
    assert_eq!(request["output_config"]["effort"], "medium");
    // From the config, not a constant: `max_tokens` is the helper's most
    // expensive knob and has to be tunable on the host.
    assert_eq!(request["max_tokens"], 8192);
    assert_eq!(request["fallbacks"], "default");
    assert_eq!(request["system"][0]["cache_control"]["type"], "ephemeral");
    for rejected in ["thinking", "temperature", "top_p", "budget_tokens"] {
        assert!(
            request.get(rejected).is_none(),
            "{rejected} must not be sent to this model"
        );
    }
    // The system prompt is what keeps the helper in her vocabulary.
    let system = request["system"][0]["text"].as_str().unwrap();
    assert!(
        system.contains("haiga"),
        "the page map must reach the model"
    );
}
