//! Tests for the half of the helper that writes things down: the
//! `propose_issue` tool, the draft that waits on her decision, and the one
//! route that files a GitHub issue.
//!
//! Two local axum stubs stand in for Anthropic and for GitHub (see
//! `common/assistant.rs`) — `ANTHROPIC_BASE_URL` and `GITHUB_API_BASE_URL`
//! are configuration precisely so this is possible. Everything runs through
//! the real router, including the auth layer.
//!
//! The property most of these tests are really about: NOTHING reaches
//! GitHub until she presses the button. The model's tool stores a draft and
//! stops, which is what makes the confirmation step structural rather than
//! something a model could talk itself out of.

mod common;

use axum::http::StatusCode;
use common::assistant::{
    app_from, app_from_store, configured, get_auth, github_config, last_message, new_session,
    post_auth, say, send, spawn_stub, text_reply, tool_call_reply, tool_reply, Stub,
    ABSENT_SESSION,
};
use common::capture_tracing;
use common::store::InMemoryStore;
use kari_website_api::services::assistant::{
    session_key, AssistantLimits, FILED_MESSAGE, FILING_FAILED_MESSAGE, FILING_OFF_MESSAGE,
    NOTHING_TO_FILE_MESSAGE, PROPOSE_ISSUE_TOOL, USER_FEEDBACK_LABEL,
};
use serde_json::{json, Value};
use std::sync::Arc;

/// A `propose_issue` call with a complete draft, as the model sends it.
fn draft_reply() -> (StatusCode, Value) {
    tool_call_reply(
        PROPOSE_ISSUE_TOOL,
        json!({
            "kind": "bug",
            "title": "Photographs come out sideways",
            "summary": "Your upright photographs are showing on their side \
        once they are uploaded.",
            "body": "Kari uploads a portrait photograph from her phone and \
        it appears rotated in the gallery.\n\nExpected: the photograph keeps the \
        orientation it had.",
        }),
    )
}

/// An app whose helper can both talk and file, pointed at the two stubs.
fn app_that_can_file(anthropic: &Stub, github: &Stub) -> (Arc<InMemoryStore>, axum::Router) {
    app_from(
        configured(&anthropic.base_url, AssistantLimits::default())
            .with_github(Some(github_config(&github.base_url))),
    )
}

/// A GitHub reply for a created issue.
fn created_issue(number: u64) -> (StatusCode, Value) {
    (
        StatusCode::CREATED,
        json!({
            "number": number,
            "html_url": format!("https://github.com/adam26davidson/kari-website/issues/{number}"),
        }),
    )
}

/// Get to the state that matters: a draft on screen, nothing filed.
async fn session_with_a_draft(app: &axum::Router) -> String {
    let id = new_session(app).await;
    let (status, body) = say(app, &id, "My photographs come out sideways").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    id
}

async fn decide(app: &axum::Router, id: &str, action: &str) -> (StatusCode, Value) {
    send(
        app,
        post_auth(
            &format!("/assistant/sessions/{id}/issue"),
            json!({"action": action}),
        ),
    )
    .await
}

// ------------------------------------------------------------------- status

#[tokio::test]
async fn status_reports_filing_once_there_is_a_token() {
    let anthropic = spawn_stub(vec![text_reply("hello")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);

    let (status, body) = send(&app, get_auth("/assistant/status")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"available": true, "canFile": true}));
}

// --------------------------------------------------------- the tool itself

#[tokio::test]
async fn the_tool_is_offered_only_to_a_helper_that_can_file() {
    let anthropic = spawn_stub(vec![text_reply("Of course.")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;

    // Configured to file: the tool is declared, so the model can draft.
    let (_, app) = app_that_can_file(&anthropic, &github);
    let id = new_session(&app).await;
    say(&app, &id, "Hello").await;
    let tools = anthropic.requests()[0]["tools"].clone();
    assert_eq!(tools[0]["name"], PROPOSE_ISSUE_TOOL, "tools: {tools}");
    // Enough of a schema for the model to fill in correctly.
    let required = tools[0]["input_schema"]["required"].clone();
    assert_eq!(required, json!(["kind", "title", "summary", "body"]));
    // The description is what stops the model believing the tool files
    // anything — and it is written as a continued string literal, where a
    // rustfmt reindent would show up as doubled spaces mid-sentence.
    let description = tools[0]["description"].as_str().expect("a description");
    assert!(
        description.contains("does NOT file anything"),
        "{description}"
    );
    assert!(!description.contains("  "), "reindented: {description}");

    // A host with an API key and no GitHub token declares NO tools: a
    // helper that cannot file must not be able to promise a draft.
    let (_, offline) = app_from(configured(&anthropic.base_url, AssistantLimits::default()));
    let id = new_session(&offline).await;
    say(&offline, &id, "Hello").await;
    let request = anthropic.requests().pop().expect("a request");
    assert!(
        request.get("tools").is_none(),
        "a helper that cannot file must declare no tools: {request}"
    );
    // ...and its instructions say so rather than offering to write things
    // down it cannot write.
    let system = request["system"][0]["text"].as_str().unwrap();
    assert!(system.contains("cannot yet write things down"), "{system}");
}

#[tokio::test]
async fn a_drafted_issue_waits_on_her_and_nothing_reaches_github() {
    let anthropic = spawn_stub(vec![
        draft_reply(),
        text_reply("I've written that up — have a look and file it if it's right."),
    ])
    .await;
    let github = spawn_stub(vec![created_issue(900)]).await;
    let (store, app) = app_that_can_file(&anthropic, &github);

    let id = new_session(&app).await;
    let (status, body) = say(&app, &id, "My photographs come out sideways").await;

    assert_eq!(status, StatusCode::OK);
    // The card she sees: the title and the plain sentence, and nothing of
    // the issue body written for whoever picks it up.
    assert_eq!(
        body["draft"],
        json!({
            "kind": "bug",
            "title": "Photographs come out sideways",
            "summary": "Your upright photographs are showing on their side \
        once they are uploaded.",
        })
    );
    assert_eq!(
        last_message(&body),
        "I've written that up — have a look and file it if it's right."
    );

    // The whole point: proposing is not filing.
    assert_eq!(
        github.call_count(),
        0,
        "nothing may reach GitHub before she says so"
    );

    // The draft is on the stored session, so it survives a reload — and so
    // does the rest of the conversation.
    let stored: Value =
        serde_json::from_slice(&store.get(&session_key(&id)).expect("session").data).unwrap();
    assert_eq!(
        stored["pendingDraft"]["title"],
        "Photographs come out sideways"
    );
    assert!(stored["filedIssues"].as_array().unwrap().is_empty());

    let (status, reloaded) = send(&app, get_auth(&format!("/assistant/sessions/{id}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reloaded["draft"]["title"], "Photographs come out sideways");
}

#[tokio::test]
async fn the_tool_result_round_trip_still_declares_the_tools() {
    // The bug this test exists for: the Messages API answers a request whose
    // transcript carries `tool_use`/`tool_result` blocks with a 400 when
    // `tools` is absent — so the continuation after a tool result has to
    // carry them too, not just the first call of the turn.
    let anthropic = spawn_stub(vec![draft_reply(), text_reply("Done.")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);

    let id = new_session(&app).await;
    say(&app, &id, "My photographs come out sideways").await;

    let requests = anthropic.requests();
    assert_eq!(requests.len(), 2, "the turn round-tripped through the tool");
    let continuation = &requests[1];
    assert_eq!(
        continuation["tools"][0]["name"], PROPOSE_ISSUE_TOOL,
        "the post-tool_result request must still declare the tools: {continuation}"
    );
    // ...and it is the request carrying the tool_result, which is what
    // makes the omission a 400.
    let messages = continuation["messages"].as_array().unwrap();
    let last = messages.last().unwrap();
    assert_eq!(last["content"][0]["type"], "tool_result");
    assert_eq!(last["content"][0]["is_error"], false);
}

#[tokio::test]
async fn a_half_written_draft_is_sent_back_to_the_model() {
    let _trace = capture_tracing();
    // No title. A card with an empty heading is worse than asking again.
    let anthropic = spawn_stub(vec![
        tool_call_reply(
            PROPOSE_ISSUE_TOOL,
            json!({"kind": "idea", "summary": "Something", "body": "Something"}),
        ),
        text_reply("Let me try that again."),
    ])
    .await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);

    let id = new_session(&app).await;
    let (status, body) = say(&app, &id, "An idea").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["draft"], Value::Null, "no half-draft on her screen");
    let requests = anthropic.requests();
    let result = &requests[1]["messages"].as_array().unwrap().last().unwrap()["content"][0];
    assert_eq!(result["type"], "tool_result");
    assert_eq!(result["is_error"], true);
    assert_eq!(github.call_count(), 0);
}

#[tokio::test]
async fn an_unknown_tool_is_still_refused() {
    let _trace = capture_tracing();
    // Reading the repo is a later slice. A call for it must be answered, not
    // dropped — an unanswered `tool_use` breaks the next request.
    let anthropic = spawn_stub(vec![
        tool_reply("search_repo"),
        text_reply("I can't look yet."),
    ])
    .await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);

    let id = new_session(&app).await;
    let (status, body) = say(&app, &id, "What does the home page show?").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(last_message(&body), "I can't look yet.");
    let requests = anthropic.requests();
    let result = &requests[1]["messages"].as_array().unwrap().last().unwrap()["content"][0];
    assert_eq!(result["is_error"], true);
    assert_eq!(body["draft"], Value::Null);
}

// -------------------------------------------------------------- her decision

#[tokio::test]
async fn filing_sends_the_draft_the_transcript_and_the_context_to_github() {
    let anthropic = spawn_stub(vec![draft_reply(), text_reply("Have a look.")]).await;
    let github = spawn_stub(vec![created_issue(912)]).await;
    let (store, app) = app_that_can_file(&anthropic, &github);

    let id = new_session(&app).await;
    send(
        &app,
        post_auth(
            &format!("/assistant/sessions/{id}/messages"),
            json!({
                "text": "My photographs come out sideways",
                "context": {
                    "route": "/photography",
                    "what": "photograph",
                    "id": "img-7",
                    "title": "Low tide",
                },
            }),
        ),
    )
    .await;

    let (status, body) = decide(&app, &id, "file").await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // One POST, to the right repository, with the right credential.
    assert_eq!(github.call_count(), 1);
    assert_eq!(
        github.paths(),
        vec!["/repos/adam26davidson/kari-website/issues".to_string()]
    );
    assert_eq!(
        github.header(0, "authorization").as_deref(),
        Some("Bearer test-github-token")
    );

    let filed = &github.requests()[0];
    assert_eq!(filed["title"], "Photographs come out sideways");
    // The label is what puts her words at the front of the pipeline's queue.
    assert_eq!(filed["labels"], json!([USER_FEEDBACK_LABEL]));

    let filed_body = filed["body"].as_str().expect("an issue body");
    // What the model wrote, for whoever picks it up.
    assert!(
        filed_body.contains("appears rotated in the gallery"),
        "{filed_body}"
    );
    // The sentence she actually approved on screen.
    assert!(filed_body.contains("showing on their side"), "{filed_body}");
    // Where she was, so the issue is not a mystery.
    assert!(filed_body.contains("/photography"), "{filed_body}");
    assert!(filed_body.contains("Low tide"), "{filed_body}");
    assert!(filed_body.contains("Site version:"), "{filed_body}");
    // And the whole conversation — composed HERE rather than asked of the
    // model, so it cannot be left out.
    assert!(
        filed_body.contains("**Kari:** My photographs come out sideways"),
        "{filed_body}"
    );
    assert!(
        filed_body.contains("**Helper:** Have a look."),
        "{filed_body}"
    );
    assert!(filed_body.contains(USER_FEEDBACK_LABEL), "{filed_body}");

    // What she is told: one warm line with somewhere to click.
    let messages = body["messages"].as_array().unwrap();
    let confirmation = messages.last().unwrap();
    assert_eq!(confirmation["text"], FILED_MESSAGE);
    assert_eq!(confirmation["issue"]["number"], 912);
    assert_eq!(
        confirmation["issue"]["url"],
        "https://github.com/adam26davidson/kari-website/issues/912"
    );
    // The card is gone — the decision has been made.
    assert_eq!(body["draft"], Value::Null);

    // The session records it, so a reload still shows the link and the
    // model is told what she did before its next turn.
    let stored: Value =
        serde_json::from_slice(&store.get(&session_key(&id)).expect("session").data).unwrap();
    assert_eq!(stored["filedIssues"][0]["number"], 912);
    assert_eq!(stored["pendingDraft"], Value::Null);
    let notes = stored["pendingNotes"].as_array().unwrap();
    assert!(
        notes[0].as_str().unwrap().contains("#912"),
        "the model must learn she filed it: {notes:?}"
    );
}

#[tokio::test]
async fn the_model_hears_what_she_decided_on_her_next_message() {
    let anthropic = spawn_stub(vec![
        draft_reply(),
        text_reply("Have a look."),
        text_reply("Thank you."),
    ])
    .await;
    let github = spawn_stub(vec![created_issue(77)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);

    let id = session_with_a_draft(&app).await;
    decide(&app, &id, "file").await;
    let (status, _) = say(&app, &id, "Thanks").await;
    assert_eq!(status, StatusCode::OK);

    // Carried in front of her next message rather than pushed in as a
    // message of its own: the stored transcript alternates user and
    // assistant turns, and the loop's replay guarantees depend on that.
    let messages = anthropic.requests()[2]["messages"]
        .as_array()
        .unwrap()
        .clone();
    let latest = messages.last().unwrap()["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(latest.contains("#77"), "{latest}");
    assert!(latest.contains("Thanks"), "her own words survive: {latest}");
    let roles: Vec<&str> = messages
        .iter()
        .map(|m| m["role"].as_str().unwrap())
        .collect();
    for (i, role) in roles.iter().enumerate() {
        let expected = if i % 2 == 0 { "user" } else { "assistant" };
        assert_eq!(role, &expected, "roles must alternate: {roles:?}");
    }
}

#[tokio::test]
async fn not_now_clears_the_card_and_files_nothing() {
    let anthropic = spawn_stub(vec![draft_reply(), text_reply("Have a look.")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (store, app) = app_that_can_file(&anthropic, &github);

    let id = session_with_a_draft(&app).await;
    let (status, body) = decide(&app, &id, "dismiss").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["draft"], Value::Null);
    assert_eq!(github.call_count(), 0, "dismissing must file nothing");
    // No new line in the transcript: she did not do anything worth
    // announcing back to her.
    assert_eq!(last_message(&body), "Have a look.");

    let stored: Value =
        serde_json::from_slice(&store.get(&session_key(&id)).expect("session").data).unwrap();
    assert_eq!(stored["pendingDraft"], Value::Null);
    assert!(stored["filedIssues"].as_array().unwrap().is_empty());
    assert!(stored["pendingNotes"][0]
        .as_str()
        .unwrap()
        .contains("chose not to file"));
}

#[tokio::test]
async fn a_card_can_be_dismissed_even_where_filing_was_never_possible() {
    // Her token could be removed between the draft and the decision, and a
    // card she cannot get rid of is a dead end. Dismissing needs no
    // configuration at all.
    let anthropic = spawn_stub(vec![draft_reply(), text_reply("Have a look.")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (store, app) = app_that_can_file(&anthropic, &github);
    let id = session_with_a_draft(&app).await;

    let offline = app_from_store(
        store.clone(),
        configured(&anthropic.base_url, AssistantLimits::default()),
    );
    let (status, body) = decide(&offline, &id, "dismiss").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["draft"], Value::Null);
}

#[tokio::test]
async fn filing_without_a_github_token_says_so_and_keeps_the_conversation() {
    let _trace = capture_tracing();
    let anthropic = spawn_stub(vec![draft_reply(), text_reply("Have a look.")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (store, app) = app_that_can_file(&anthropic, &github);
    let id = session_with_a_draft(&app).await;

    // The same conversation, on a host with no GitHub token.
    let offline = app_from_store(
        store.clone(),
        configured(&anthropic.base_url, AssistantLimits::default()),
    );
    let (status, body) = decide(&offline, &id, "file").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, json!({"error": FILING_OFF_MESSAGE}));
    assert_eq!(github.call_count(), 0);

    // The draft is still there, and so is the conversation: the helper
    // carries on talking, it just cannot write anything down.
    let (status, reloaded) = send(&offline, get_auth(&format!("/assistant/sessions/{id}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reloaded["draft"]["title"], "Photographs come out sideways");
}

#[tokio::test]
async fn a_github_outage_keeps_the_draft_for_another_try() {
    let _trace = capture_tracing();
    let anthropic = spawn_stub(vec![draft_reply(), text_reply("Have a look.")]).await;
    // A bad gateway first, then a working GitHub for the retry.
    let github = spawn_stub(vec![
        (StatusCode::BAD_GATEWAY, json!({"message": "oh dear"})),
        created_issue(55),
    ])
    .await;
    let (_, app) = app_that_can_file(&anthropic, &github);
    let id = session_with_a_draft(&app).await;

    let (status, body) = decide(&app, &id, "file").await;
    // 503, not 500: nothing is broken on her side and trying again is worth
    // doing — which is only true because the draft is still there.
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, json!({"error": FILING_FAILED_MESSAGE}));

    let (status, retried) = decide(&app, &id, "file").await;
    assert_eq!(status, StatusCode::OK, "{retried}");
    assert_eq!(last_message(&retried), FILED_MESSAGE);
    assert_eq!(
        retried["messages"].as_array().unwrap().last().unwrap()["issue"]["number"],
        55
    );
}

#[tokio::test]
async fn a_rejected_filing_is_reported_calmly_too() {
    let _trace = capture_tracing();
    let anthropic = spawn_stub(vec![draft_reply(), text_reply("Have a look.")]).await;
    // An expired token, or a label that no longer exists. She cannot fix
    // either, and neither changes what she does next.
    let github = spawn_stub(vec![(
        StatusCode::UNAUTHORIZED,
        json!({"message": "Bad credentials"}),
    )])
    .await;
    let (_, app) = app_that_can_file(&anthropic, &github);
    let id = session_with_a_draft(&app).await;

    let (status, body) = decide(&app, &id, "file").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    // GitHub's own words never reach the browser.
    assert_eq!(body, json!({"error": FILING_FAILED_MESSAGE}));
}

#[tokio::test]
async fn filing_with_nothing_drafted_is_a_bad_request() {
    let anthropic = spawn_stub(vec![text_reply("Of course.")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);
    let id = new_session(&app).await;

    // Reachable from a stale panel — a second window, or a reload partway
    // through the decision.
    let (status, body) = decide(&app, &id, "file").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"error": NOTHING_TO_FILE_MESSAGE}));
    assert_eq!(github.call_count(), 0);
}

#[tokio::test]
async fn an_unknown_decision_is_refused() {
    let anthropic = spawn_stub(vec![draft_reply(), text_reply("Have a look.")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);
    let id = session_with_a_draft(&app).await;

    let (status, _) = decide(&app, &id, "file-it-twice-maybe").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(github.call_count(), 0);
}

#[tokio::test]
async fn a_conversation_that_never_existed_cannot_file() {
    let anthropic = spawn_stub(vec![text_reply("Of course.")]).await;
    let github = spawn_stub(vec![created_issue(1)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);

    let (status, _) = decide(&app, ABSENT_SESSION, "file").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // And a session id can never be a path into the bucket, here either.
    for id in ["..%2F..%2Fsite-settings", "site-settings"] {
        let (status, _) = decide(&app, id, "file").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "id {id} must be refused");
    }
    assert_eq!(github.call_count(), 0);
}

#[tokio::test]
async fn a_very_long_conversation_still_fits_in_an_issue() {
    // GitHub rejects a body over 65,536 bytes, and a long conversation can
    // get there. Losing the filing to a long chat would be the wrong trade,
    // so the transcript is trimmed from the front and says that it was.
    let long = "x".repeat(4_000);
    let mut replies = vec![];
    for _ in 0..30 {
        replies.push(text_reply(&long));
    }
    replies.push(draft_reply());
    replies.push(text_reply("Have a look."));
    let anthropic = spawn_stub(replies).await;
    let github = spawn_stub(vec![created_issue(3)]).await;
    let (_, app) = app_that_can_file(&anthropic, &github);

    let id = new_session(&app).await;
    for _ in 0..30 {
        say(&app, &id, "Tell me more").await;
    }
    say(&app, &id, "My photographs come out sideways").await;
    let (status, body) = decide(&app, &id, "file").await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let filed_body = github.requests()[0]["body"].as_str().unwrap().to_string();
    assert!(
        filed_body.len() < 65_536,
        "the issue body must fit: {} bytes",
        filed_body.len()
    );
    assert!(
        filed_body.contains("too long to include"),
        "a trimmed transcript must say so"
    );
    // The end of the conversation — the part that led to the draft — is
    // what survives the trim.
    assert!(
        filed_body.contains("**Helper:** Have a look."),
        "kept the tail"
    );
}
