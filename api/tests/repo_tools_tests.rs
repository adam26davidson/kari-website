//! Tests for the helper's read-only eyes on the codebase.
//!
//! Two halves. The first drives `RepoAccess` directly against a small
//! fixture tree (`common/repo.rs`) — what the three tools return, and (much
//! more to the point) what they refuse: anything reaching outside the
//! snapshot root, and anything inside the directories the tools pretend do
//! not exist.
//!
//! The second runs the real router with the shared helper harness
//! (`common/assistant.rs`), so the tool-result round trip is exercised as it
//! actually ships: a stub Anthropic asks for a repo tool, and the
//! continuation request has to carry both the answer and the `tools` array.
//!
//! Nothing here touches an environment variable — the snapshot root is
//! injected. `REPO_DIR` is process-global, so how it is read is tested in
//! its own binary, `repo_dir_tests.rs`.

mod common;

use axum::http::StatusCode;
use common::assistant::{
    app_from, configured, new_session, say, spawn_stub, text_reply, tool_call_reply,
};
use common::repo::Fixture;
use kari_website_api::services::assistant::AssistantLimits;
use kari_website_api::services::repo_tools::{
    is_repo_tool, tools, RepoAccess, LIST_TOOL, READ_TOOL, REPO_UNAVAILABLE, SEARCH_TOOL,
};
use serde_json::json;

/// `run` answers `(is_error, content)`; most assertions want the content
/// and a claim about which of the two it was.
fn ok(repo: &RepoAccess, tool: &str, input: serde_json::Value) -> String {
    let (is_error, content) = repo.run(tool, &input);
    assert!(!is_error, "expected {tool} to succeed, got: {content}");
    content
}

fn refused(repo: &RepoAccess, tool: &str, input: serde_json::Value) -> String {
    let (is_error, content) = repo.run(tool, &input);
    assert!(is_error, "expected {tool} to refuse, got: {content}");
    content
}

// ------------------------------------------------------------------ opening

#[test]
fn a_missing_directory_is_simply_no_snapshot() {
    // The state every host was in before this shipped, and the one a local
    // `cargo run` is in. Not an error — there is nothing to fail.
    assert!(RepoAccess::open("/nonexistent/kari-website-snapshot").is_none());
}

#[test]
fn a_file_is_not_a_snapshot() {
    let fixture = Fixture::repo();
    assert!(RepoAccess::open(fixture.path().join("README.md")).is_none());
}

// ------------------------------------------------------------------ listing

#[test]
fn listing_the_root_names_the_top_level() {
    let fixture = Fixture::repo();
    let listing = ok(&fixture.access(), LIST_TOOL, json!({"path": ""}));

    assert!(listing.contains("api/"), "{listing}");
    assert!(listing.contains("ui/"), "{listing}");
    assert!(listing.contains("README.md"), "{listing}");
    // Folders are marked so the model knows which way to go next.
    assert!(!listing.contains("README.md/"), "{listing}");
}

#[test]
fn build_output_and_dependencies_are_invisible() {
    let fixture = Fixture::repo();
    let repo = fixture.access();

    let root = ok(&repo, LIST_TOOL, json!({"path": ""}));
    assert!(!root.contains("node_modules"), "{root}");

    let ui = ok(&repo, LIST_TOOL, json!({"path": "ui"}));
    assert!(!ui.contains("dist"), "{ui}");

    // ...and a search never walks into them either, which is what keeps a
    // development `REPO_DIR` pointed at a live clone usable at all.
    let found = ok(&repo, SEARCH_TOOL, json!({"query": "haiku editor"}));
    assert!(!found.contains("node_modules"), "{found}");
    assert!(!found.contains("dist/"), "{found}");
    assert!(!found.contains(".git/"), "{found}");
}

#[test]
fn naming_an_invisible_directory_outright_does_not_get_into_it() {
    // Skipping them only while walking would leave the front door open: a
    // model that already knows the name could ask for the path directly.
    // `.git/config` is the one that matters — on a development host
    // `REPO_DIR` is a live clone, so that file is real and holds the remote.
    let fixture = Fixture::repo();
    let repo = fixture.access();

    for path in [
        ".git",
        ".git/config",
        "node_modules",
        "node_modules/left-pad/index.js",
        "ui/dist",
        "./node_modules",
    ] {
        for tool in [READ_TOOL, LIST_TOOL] {
            let message = refused(&repo, tool, json!({"path": path}));
            assert!(
                message.contains("is no"),
                "{tool} did not hide {path}: {message}"
            );
        }
        // ...including as the folder a search is pointed at, which would
        // otherwise start its walk below the skip check entirely.
        let message = refused(
            &repo,
            SEARCH_TOOL,
            json!({"query": "haiku editor", "path_prefix": path}),
        );
        assert!(
            message.contains("is no"),
            "a search into {path} was not refused: {message}"
        );
    }
}

#[test]
fn listing_a_file_says_to_read_it_instead() {
    let fixture = Fixture::repo();
    let message = refused(&fixture.access(), LIST_TOOL, json!({"path": "README.md"}));
    assert!(message.contains(READ_TOOL), "{message}");
}

#[test]
fn listing_something_absent_says_so_and_points_somewhere_useful() {
    let fixture = Fixture::repo();
    let message = refused(&fixture.access(), LIST_TOOL, json!({"path": "ui/nope"}));
    assert!(message.contains("ui/nope"), "{message}");
    assert!(message.contains(SEARCH_TOOL), "{message}");
}

// ------------------------------------------------------------------ reading

#[test]
fn reading_a_file_returns_its_text_and_says_how_long_it_is() {
    let fixture = Fixture::repo();
    let body = ok(
        &fixture.access(),
        READ_TOOL,
        json!({"path": "api/src/services/assistant.rs"}),
    );

    assert!(body.contains("RESTING_MESSAGE"), "{body}");
    assert!(body.contains("lines 1-2 of 2"), "{body}");
}

#[test]
fn a_line_range_returns_only_those_lines() {
    let fixture = Fixture::repo();
    fixture.write("long.txt", "one\ntwo\nthree\nfour\nfive\n");

    let body = ok(
        &fixture.access(),
        READ_TOOL,
        json!({"path": "long.txt", "start_line": 2, "end_line": 3}),
    );

    assert!(body.contains("lines 2-3 of 5"), "{body}");
    assert!(body.contains("two\nthree\n"), "{body}");
    assert!(!body.contains("five"), "{body}");
}

#[test]
fn line_numbers_sent_as_text_are_understood() {
    // Models do send "2" where the schema says 2, and answering "that is not
    // a line number" would be pedantry.
    let fixture = Fixture::repo();
    fixture.write("long.txt", "one\ntwo\nthree\n");

    let body = ok(
        &fixture.access(),
        READ_TOOL,
        json!({"path": "long.txt", "start_line": "2"}),
    );
    assert!(body.contains("lines 2-3 of 3"), "{body}");
}

#[test]
fn a_line_past_the_end_says_how_long_the_file_is() {
    let fixture = Fixture::repo();
    fixture.write("long.txt", "one\ntwo\n");
    let message = refused(
        &fixture.access(),
        READ_TOOL,
        json!({"path": "long.txt", "start_line": 99}),
    );
    assert!(message.contains("only 2 lines"), "{message}");
}

#[test]
fn a_long_file_is_trimmed_and_says_where_to_pick_it_up() {
    let fixture = Fixture::repo();
    // Comfortably past the 50 KB cap: 4,000 lines of ~30 bytes.
    let long = (0..4_000)
        .map(|n| format!("line {n} of a very long generated file\n"))
        .collect::<String>();
    assert!(long.len() > 60_000, "the fixture must exceed the read cap");
    fixture.write("huge.txt", &long);

    let body = ok(&fixture.access(), READ_TOOL, json!({"path": "huge.txt"}));

    assert!(body.len() < 60_000, "the answer must be capped");
    assert!(body.contains("trimmed here — read from line"), "{body}");
    // ...and the line it names is one the model can actually ask for.
    assert!(body.contains("of 4000"), "{body}");
}

#[test]
fn a_file_that_is_not_text_is_declined_rather_than_mangled() {
    let fixture = Fixture::repo();
    std::fs::write(fixture.path().join("photo.bin"), [0xff, 0xfe, 0x00, 0x9f]).unwrap();
    let message = refused(&fixture.access(), READ_TOOL, json!({"path": "photo.bin"}));
    assert!(message.contains("not a text file"), "{message}");
}

#[test]
fn reading_a_folder_says_to_list_it_instead() {
    let fixture = Fixture::repo();
    let message = refused(&fixture.access(), READ_TOOL, json!({"path": "ui"}));
    assert!(message.contains(LIST_TOOL), "{message}");
}

// --------------------------------------------------------------- searching

#[test]
fn search_finds_the_file_a_phrase_lives_in() {
    let fixture = Fixture::repo();
    let found = ok(
        &fixture.access(),
        SEARCH_TOOL,
        json!({"query": "URL-driven"}),
    );
    assert!(
        found.contains("ui/apps/admin/src/admin-haiku-page/admin-haiku-page.tsx:2:"),
        "{found}"
    );
}

#[test]
fn search_ignores_case_so_her_wording_still_finds_it() {
    let fixture = Fixture::repo();
    let found = ok(&fixture.access(), SEARCH_TOOL, json!({"query": "resting"}));
    assert!(found.contains("api/src/services/assistant.rs"), "{found}");
}

#[test]
fn a_path_prefix_narrows_the_search() {
    let fixture = Fixture::repo();
    let found = ok(
        &fixture.access(),
        SEARCH_TOOL,
        json!({"query": "export function", "path_prefix": "ui/apps/admin/src/components"}),
    );
    assert!(found.contains("editor-page.tsx"), "{found}");
    assert!(!found.contains("admin-haiku-page.tsx"), "{found}");
}

#[test]
fn a_search_that_finds_nothing_says_so_plainly() {
    let fixture = Fixture::repo();
    let found = ok(
        &fixture.access(),
        SEARCH_TOOL,
        json!({"query": "quantum tunnelling"}),
    );
    // Not an error: nothing is wrong, there is simply no match.
    assert!(found.contains("Nothing in the site's code"), "{found}");
}

#[test]
fn a_one_letter_search_is_turned_down() {
    let fixture = Fixture::repo();
    let message = refused(&fixture.access(), SEARCH_TOOL, json!({"query": "e"}));
    assert!(message.contains("two characters"), "{message}");
}

// ------------------------------------------------------------- staying put

#[test]
fn a_traversing_path_cannot_reach_outside_the_snapshot() {
    let fixture = Fixture::repo();
    let repo = fixture.access();

    for path in [
        "../../etc/passwd",
        "..",
        "ui/../../etc/passwd",
        "ui/./../../secrets.env",
    ] {
        let message = refused(&repo, READ_TOOL, json!({"path": path}));
        assert!(
            message.contains("outside the site's code"),
            "{path} was not refused: {message}"
        );
    }
}

#[test]
fn an_absolute_path_is_refused() {
    let fixture = Fixture::repo();
    let repo = fixture.access();
    for tool in [READ_TOOL, LIST_TOOL] {
        let message = refused(&repo, tool, json!({"path": "/etc/passwd"}));
        assert!(message.contains("outside the site's code"), "{message}");
    }
    // ...including as the folder a search is pointed at.
    let message = refused(
        &repo,
        SEARCH_TOOL,
        json!({"query": "root", "path_prefix": "/etc"}),
    );
    assert!(message.contains("outside the site's code"), "{message}");
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_snapshot_is_refused() {
    // `git archive` does not follow symlinks, so nothing should create this
    // — which is exactly why the canonicalised prefix check has to be the
    // thing that makes it safe, rather than how the bundle happens to be
    // built.
    let outside = Fixture::new();
    outside.write("secrets.env", "ANTHROPIC_API_KEY=sk-should-never-be-read\n");
    let fixture = Fixture::repo();
    std::os::unix::fs::symlink(
        outside.path().join("secrets.env"),
        fixture.path().join("escape.env"),
    )
    .expect("create the symlink");

    let message = refused(&fixture.access(), READ_TOOL, json!({"path": "escape.env"}));
    assert!(message.contains("outside the site's code"), "{message}");
}

#[cfg(unix)]
#[test]
fn a_search_does_not_follow_a_symlink_out_of_the_snapshot() {
    // The front door is shut (the test above) — this is the back one. A walk
    // that followed links would hand back the very bytes `read_repo_file`
    // refuses, because both `is_dir()` and `fs::read` follow them. Two shapes,
    // and the directory is the worse of the pair: one link and the whole tree
    // on the other end gets walked and searched.
    let outside = Fixture::new();
    let secret = "ANTHROPIC_API_KEY=sk-should-never-be-read\n";
    outside.write("secrets.env", secret);
    outside.write("private/notes.md", secret);
    let fixture = Fixture::repo();
    std::os::unix::fs::symlink(
        outside.path().join("secrets.env"),
        fixture.path().join("escape.env"),
    )
    .expect("create the file symlink");
    std::os::unix::fs::symlink(
        outside.path().join("private"),
        fixture.path().join("ui/escape-dir"),
    )
    .expect("create the directory symlink");
    let repo = fixture.access();

    let found = ok(&repo, SEARCH_TOOL, json!({"query": "anthropic_api_key"}));
    assert!(
        found.contains("Nothing in the site's code"),
        "the search read outside the snapshot: {found}"
    );

    // ...and neither does pointing the search straight at the linked folder.
    let message = refused(
        &repo,
        SEARCH_TOOL,
        json!({"query": "anthropic_api_key", "path_prefix": "ui/escape-dir"}),
    );
    assert!(message.contains("outside the site's code"), "{message}");
}

#[cfg(unix)]
#[test]
fn a_symlink_inside_the_snapshot_costs_the_search_nothing() {
    // The walk skips links rather than deciding per link where each one
    // lands, so this is what "skipped" is worth: anything a link inside the
    // snapshot points at is still reached by its real path, and reported once
    // under that path rather than twice.
    let fixture = Fixture::repo();
    std::os::unix::fs::symlink(
        fixture.path().join("api/src/services/assistant.rs"),
        fixture.path().join("ui/assistant-link.rs"),
    )
    .expect("create the symlink");

    let found = ok(&fixture.access(), SEARCH_TOOL, json!({"query": "resting"}));
    assert!(
        found.contains("api/src/services/assistant.rs:2:"),
        "{found}"
    );
    assert!(!found.contains("assistant-link.rs"), "{found}");
}

// ------------------------------------------------------------- declarations

#[test]
fn the_three_tools_are_declared_and_recognised() {
    let declared: Vec<String> = tools()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(declared.len(), 3, "{declared:?}");
    for name in [LIST_TOOL, READ_TOOL, SEARCH_TOOL] {
        assert!(declared.contains(&name.to_string()), "{declared:?}");
        assert!(is_repo_tool(name));
    }
    assert!(!is_repo_tool("propose_issue"));
}

// ------------------------------------------------------- through the router

#[tokio::test]
async fn a_repo_tool_call_round_trips_through_the_turn_loop() {
    let fixture = Fixture::repo();
    let anthropic = spawn_stub(vec![
        tool_call_reply(SEARCH_TOOL, json!({"query": "URL-driven"})),
        text_reply("The haiku editor opens from its own web address."),
    ])
    .await;
    let (_, app) = app_from(
        configured(&anthropic.base_url, AssistantLimits::default())
            .with_repo(RepoAccess::open(fixture.path())),
    );

    let id = new_session(&app).await;
    let (status, body) = say(&app, &id, "How does the haiku editor open?").await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let requests = anthropic.requests();
    assert_eq!(requests.len(), 2, "the turn round-tripped through the tool");

    // The first request offers the three tools...
    let declared = requests[0]["tools"].as_array().expect("tools declared");
    assert_eq!(declared.len(), 3, "{}", requests[0]);

    // ...the second carries the answer, with real file content in it...
    let continuation = &requests[1];
    let messages = continuation["messages"].as_array().unwrap();
    let result = &messages.last().unwrap()["content"][0];
    assert_eq!(result["type"], "tool_result");
    assert_eq!(result["is_error"], false);
    let content = result["content"].as_str().expect("tool result content");
    assert!(content.contains("admin-haiku-page.tsx"), "{content}");

    // ...and it still declares the tools, which the Messages API requires of
    // any request whose transcript holds tool blocks.
    assert!(
        continuation["tools"]
            .as_array()
            .is_some_and(|t| t.len() == 3),
        "the post-tool_result request must still declare the tools: {continuation}"
    );
}

#[tokio::test]
async fn a_host_with_no_snapshot_declares_no_repo_tools() {
    let anthropic = spawn_stub(vec![
        tool_call_reply(READ_TOOL, json!({"path": "api/src/main.rs"})),
        text_reply("I'm not sure, so I would rather not guess."),
    ])
    .await;
    // No `with_repo`: the state slices 1 and 2 shipped, and the state of any
    // host whose bundle predates the snapshot.
    let (_, app) = app_from(configured(&anthropic.base_url, AssistantLimits::default()));

    let id = new_session(&app).await;
    let (status, _) = say(&app, &id, "What does the main file do?").await;
    assert_eq!(status, StatusCode::OK);

    let requests = anthropic.requests();
    // `build_request` omits the key entirely when there is nothing to
    // declare, which is what "no tools" looks like on the wire.
    assert!(requests[0]["tools"].is_null(), "{}", requests[0]);

    // A call that arrives anyway is still answered — an unanswered
    // `tool_use` would be a 400 on the very next request — and the answer
    // says the code is not available rather than that something failed.
    let messages = requests[1]["messages"].as_array().unwrap();
    let result = &messages.last().unwrap()["content"][0];
    assert_eq!(result["type"], "tool_result");
    assert_eq!(result["content"], REPO_UNAVAILABLE);
}

#[tokio::test]
async fn the_prompt_only_offers_the_code_when_there_is_some() {
    let fixture = Fixture::repo();
    let anthropic = spawn_stub(vec![text_reply("Hello.")]).await;

    let (_, reading) = app_from(
        configured(&anthropic.base_url, AssistantLimits::default())
            .with_repo(RepoAccess::open(fixture.path())),
    );
    let id = new_session(&reading).await;
    say(&reading, &id, "Hello").await;

    let (_, blind) = app_from(configured(&anthropic.base_url, AssistantLimits::default()));
    let id = new_session(&blind).await;
    say(&blind, &id, "Hello").await;

    let requests = anthropic.requests();
    let with_code = requests[0]["system"].to_string();
    let without_code = requests[1]["system"].to_string();
    assert!(with_code.contains("read the site's own source code"));
    // The helper must never claim to have checked something it cannot see.
    assert!(!without_code.contains("source code"), "{without_code}");
}
