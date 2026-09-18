//! Tests for the helper's read-only eyes on the codebase.
//!
//! Two halves. The first drives `RepoAccess` directly against a small
//! fixture tree — what the three tools return, and (much more to the point)
//! what they refuse: anything reaching outside the snapshot root.
//!
//! The second runs the real router with the shared helper harness
//! (`common/assistant.rs`), so the tool-result round trip is exercised as it
//! actually ships: a stub Anthropic asks for a repo tool, and the
//! continuation request has to carry both the answer and the `tools` array.

mod common;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::StatusCode;
use common::assistant::{
    app_from, configured, new_session, say, spawn_stub, text_reply, tool_call_reply,
};
use kari_website_api::services::assistant::AssistantLimits;
use kari_website_api::services::repo_tools::{
    is_repo_tool, tools, RepoAccess, LIST_TOOL, READ_TOOL, REPO_UNAVAILABLE, SEARCH_TOOL,
};
use serde_json::json;

// ------------------------------------------------------------- the fixture

/// A throwaway directory tree standing in for the deploy bundle's snapshot.
///
/// Built by hand rather than with a temp-directory crate: this is the only
/// place in the API that needs one, and a new dependency to save fifteen
/// lines is a poor trade (`docs/dependency-management.md`). Names are
/// unique per process and per fixture so the parallel test threads cannot
/// collide, and `Drop` clears up even when an assertion panics.
struct Fixture {
    root: PathBuf,
}

static FIXTURE_COUNT: AtomicUsize = AtomicUsize::new(0);

impl Fixture {
    fn new() -> Self {
        let n = FIXTURE_COUNT.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("kari-repo-tools-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create fixture root");
        Self { root }
    }

    /// A tree shaped like this repository's, small enough to assert on.
    fn repo() -> Self {
        let fixture = Self::new();
        fixture.write(
            "README.md",
            "# Kari's site\n\nA poetry and photography site.\n",
        );
        fixture.write(
            "ui/apps/admin/src/admin-haiku-page/admin-haiku-page.tsx",
            "export function AdminHaikuPage() {\n  // The editor is URL-driven.\n  return null;\n}\n",
        );
        fixture.write(
            "ui/apps/admin/src/components/editor-page/editor-page.tsx",
            "export function EditorPage() {\n  return <Card>Save</Card>;\n}\n",
        );
        fixture.write(
            "api/src/services/assistant.rs",
            "//! The admin helper.\npub const RESTING_MESSAGE: &str = \"resting\";\n",
        );
        // Ignored everywhere: build output and dependencies say nothing
        // about how the site behaves.
        fixture.write("node_modules/left-pad/index.js", "// haiku editor\n");
        fixture.write("ui/dist/assets/bundle.js", "// haiku editor\n");
        fixture
    }

    fn write(&self, relative: &str, contents: &str) -> PathBuf {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("create fixture dirs");
        std::fs::write(&path, contents).expect("write fixture file");
        path
    }

    fn access(&self) -> RepoAccess {
        RepoAccess::open(&self.root).expect("open the fixture as a snapshot")
    }

    fn path(&self) -> &Path {
        &self.root
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

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

#[test]
fn repo_dir_points_the_helper_at_a_snapshot() {
    // `REPO_DIR` is read from the process environment, which the tests share
    // — so this case sets it, reads it back through `from_env`, and restores
    // it rather than leaving it set for whatever runs next.
    let fixture = Fixture::repo();
    let before = std::env::var("REPO_DIR").ok();
    std::env::set_var("REPO_DIR", fixture.path());
    let opened = RepoAccess::from_env();
    match before {
        Some(value) => std::env::set_var("REPO_DIR", value),
        None => std::env::remove_var("REPO_DIR"),
    }

    let opened = opened.expect("REPO_DIR should have been opened");
    // Canonicalised, so the comparison is against the real path either way.
    assert_eq!(
        opened.root(),
        std::fs::canonicalize(fixture.path()).unwrap()
    );
}

#[test]
fn a_repo_dir_that_is_not_there_leaves_the_helper_without_code() {
    let before = std::env::var("REPO_DIR").ok();
    std::env::set_var("REPO_DIR", "/nonexistent/kari-website-snapshot");
    let opened = RepoAccess::from_env();
    match before {
        Some(value) => std::env::set_var("REPO_DIR", value),
        None => std::env::remove_var("REPO_DIR"),
    }
    assert!(opened.is_none());
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
