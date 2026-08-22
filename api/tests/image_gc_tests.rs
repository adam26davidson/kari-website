//! Tests for the image garbage-collection sweep: the reference-extraction
//! helpers in `services/image_gc.rs` and the `POST /images/gc` handler driven
//! through the real router (auth layer included) with the in-memory store.
//!
//! The two invariants under test are the ones the sweep must never break:
//! a referenced file is never deleted, and any manifest fetch/parse failure
//! aborts the sweep before anything is deleted.

mod common;

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use common::store::{state_with_store, InMemoryStore};
use common::{build_jwks, signed_token, TokenOptions};
use http_body_util::BodyExt;
use kari_website_api::routes::create_router;
use kari_website_api::services::image_gc::{
    add_reference, collect_referenced_images, extract_html_image_refs,
};
use serde_json::{json, Value};
use tower::ServiceExt;

// ------------------------------------------------- reference extraction

fn refs_from(html: &str) -> HashSet<String> {
    let mut refs = HashSet::new();
    extract_html_image_refs(html, &mut refs);
    refs
}

#[test]
fn extracts_s3_and_api_hosted_image_urls() {
    // Published posts embed the S3 URL, drafts the API URL; both must count.
    let refs = refs_from(
        r#"<p>hi</p><img src="https://s3.example.com/bucket/images/pub.jpg">
           <img src='http://localhost:3000/images/draft.png'/>"#,
    );
    assert!(refs.contains("pub.jpg"));
    assert!(refs.contains("draft.png"));
}

#[test]
fn extracts_multiple_references_and_ignores_unrelated_paths() {
    let refs = refs_from(
        r#"<img src="https://h/images/a.jpg"><a href="https://h/blog/post.html">x</a>
           <img src="https://h/images/b.jpg">"#,
    );
    assert!(refs.contains("a.jpg"));
    assert!(refs.contains("b.jpg"));
    assert!(!refs.contains("post.html"));
}

#[test]
fn percent_encoded_names_also_count_in_decoded_form() {
    // The browser may percent-encode a file name with spaces in `src`; the
    // S3 key is the raw name, so the decoded spelling must be referenced.
    let refs = refs_from(r#"<img src="https://h/images/my%20photo.jpg">"#);
    assert!(refs.contains("my photo.jpg"));
    assert!(refs.contains("my%20photo.jpg"));
}

#[test]
fn entity_escaped_ampersands_also_count_in_decoded_form() {
    // An HTML serializer escapes `&` in attributes as `&amp;`; the S3 key
    // has the raw `&`.
    let refs = refs_from(r#"<img src="https://h/images/black&amp;white.jpg">"#);
    assert!(refs.contains("black&white.jpg"));
}

#[test]
fn directory_layout_urls_reference_the_image_id() {
    // Under the directory-per-image layout (#273) a public URL names a
    // rendition inside the image's prefix; the reference is the id, which is
    // what the sweep groups objects by.
    let refs = refs_from(r#"<img src="https://h/images/pic.jpg/original.jpg">"#);
    assert!(refs.contains("pic.jpg"), "got: {refs:?}");
    assert!(
        !refs.iter().any(|r| r.contains('/')),
        "a reference is an id, not a path: {refs:?}"
    );
}

#[test]
fn reference_name_ends_at_query_fragment_or_quote() {
    let refs = refs_from(r#"<img src="https://h/images/pic.jpg?v=2#frag">"#);
    assert!(refs.contains("pic.jpg"));
    assert!(!refs.iter().any(|r| r.contains('?')));
}

#[test]
fn empty_or_absent_names_produce_no_references() {
    assert!(refs_from(r#"<a href="https://h/images/">gallery</a>"#).is_empty());
    assert!(refs_from("<p>no images at all</p>").is_empty());

    let mut refs = HashSet::new();
    add_reference("", &mut refs);
    assert!(refs.is_empty());
}

#[test]
fn invalid_percent_sequences_do_not_lose_the_raw_name() {
    let mut refs = HashSet::new();
    add_reference("100%.jpg", &mut refs);
    assert!(refs.contains("100%.jpg"));
}

// ------------------------------------------------- collect_referenced_images

fn seeded_store() -> InMemoryStore {
    InMemoryStore::default()
        .with_object("haiga.json", json!([{"id": "h1", "lines": [], "publisher": "p", "image": "haiga.jpg"}]).to_string())
        .with_object("home-page.json", json!({"photo": "home.jpg", "blurb": "b"}).to_string())
        .with_object("site-settings.json", json!({"backgroundPhoto": "background.jpg"}).to_string())
        .with_object(
            "photography.json",
            json!([{"id": "p1", "title": "t", "subtitle": "s", "blurb": "b",
                    "images": [{"image": "photo1.jpg", "blurb": ""}, {"image": "photo2.jpg", "blurb": ""}]}])
            .to_string(),
        )
        .with_object(
            "blog-posts-all.json",
            json!([{"id": "post-1", "title": "t", "date": "d", "isPublished": false}]).to_string(),
        )
        .with_object(
            "blog-posts.json",
            json!([{"id": "post-2", "title": "t", "date": "d", "isPublished": true}]).to_string(),
        )
        .with_object(
            "blog/post-1.html",
            r#"<img src="http://localhost:3000/images/blog-draft.png">"#,
        )
        .with_object(
            "blog/post-2.html",
            r#"<img src="https://s3.example.com/images/blog-pub.jpg">"#,
        )
}

#[tokio::test]
async fn collects_references_from_every_manifest_and_blog_content() {
    let store = seeded_store();
    let refs = collect_referenced_images(&store)
        .await
        .expect("collection should succeed");

    for name in [
        "haiga.jpg",
        "home.jpg",
        "background.jpg",
        "photo1.jpg",
        "photo2.jpg",
        "blog-draft.png",
        "blog-pub.jpg",
    ] {
        assert!(refs.contains(name), "missing reference to {name}");
    }
}

#[tokio::test]
async fn missing_manifests_yield_empty_reference_set() {
    // A brand-new site has no manifests at all: that is a legitimate empty
    // state, not a failure.
    let refs = collect_referenced_images(&InMemoryStore::default())
        .await
        .expect("all-NotFound should not abort");
    assert!(refs.is_empty());
}

#[tokio::test]
async fn listed_blog_post_with_missing_content_is_tolerated() {
    let store = InMemoryStore::default().with_object(
        "blog-posts-all.json",
        json!([{"id": "ghost", "title": "t", "date": "d", "isPublished": false}]).to_string(),
    );
    collect_referenced_images(&store)
        .await
        .expect("NotFound blog content is a definitive answer, not a failure");
}

#[tokio::test]
async fn manifest_fetch_failure_aborts_collection() {
    let store = seeded_store();
    store.set_failing_get_for("photography.json");
    let err = collect_referenced_images(&store)
        .await
        .expect_err("an unreadable manifest must abort");
    assert!(err.to_string().contains("photography.json"), "got: {err}");
}

#[tokio::test]
async fn blog_content_fetch_failure_aborts_collection() {
    let store = seeded_store();
    store.set_failing_get_for("blog/post-2.html");
    collect_referenced_images(&store)
        .await
        .expect_err("unreadable blog content must abort");
}

#[tokio::test]
async fn corrupt_manifest_aborts_collection() {
    let store = seeded_store().with_object("haiga.json", "{not json");
    let err = collect_referenced_images(&store)
        .await
        .expect_err("unparseable manifest must abort");
    assert!(err.to_string().contains("haiga.json"), "got: {err}");
}

// ------------------------------------------------- POST /images/gc handler

fn setup_with(store: InMemoryStore) -> (Arc<InMemoryStore>, axum::Router) {
    let store = Arc::new(store);
    let app = create_router(state_with_store(build_jwks(), store.clone()));
    (store, app)
}

fn gc_request(dry_run: Option<bool>, with_auth: bool) -> Request<Body> {
    let uri = match dry_run {
        None => "/images/gc".to_string(),
        Some(flag) => format!("/images/gc?dry_run={flag}"),
    };
    let mut builder = Request::builder().method("POST").uri(uri);
    if with_auth {
        builder = builder.header(
            header::AUTHORIZATION,
            format!("Bearer {}", signed_token(TokenOptions::default())),
        );
    }
    builder.body(Body::empty()).unwrap()
}

async fn send(app: axum::Router, req: Request<Body>) -> (StatusCode, Value) {
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

fn keys(body: &Value, field: &str) -> Vec<String> {
    body[field]
        .as_array()
        .unwrap_or_else(|| panic!("{field} should be an array, body: {body}"))
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

/// Seeded content referencing three images, plus one referenced and one
/// orphaned object under `images/`, both old enough to be outside the
/// safety margin.
fn store_with_orphan() -> InMemoryStore {
    seeded_store()
        .with_object("images/haiga.jpg", "referenced bytes")
        .with_object("images/blog-pub.jpg", "referenced bytes")
        .with_object("images/orphan.jpg", "orphan bytes")
}

// The directory layout: an image is swept as a whole prefix, never
// object by object (#273).

/// Content referencing `haiga.jpg`, with that image and an unreferenced one
/// both stored in the directory layout, old enough to be outside the safety
/// margin.
fn store_with_migrated_orphan() -> InMemoryStore {
    let old = SystemTime::now() - Duration::from_secs(24 * 60 * 60);
    seeded_store()
        .with_object_modified_at("images/haiga.jpg/original.jpg", "referenced", old)
        .with_object_modified_at("images/haiga.jpg/thumb.jpg", "referenced thumb", old)
        .with_object_modified_at("images/orphan.jpg/original.jpg", "orphan", old)
        .with_object_modified_at("images/orphan.jpg/thumb.jpg", "orphan thumb", old)
}

#[tokio::test]
async fn gc_keeps_every_rendition_of_a_referenced_image() {
    let (store, app) = setup_with(store_with_migrated_orphan().with_object(
        // A half-migrated image: the legacy object is referenced too.
        "images/haiga.jpg",
        "legacy",
    ));
    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        keys(&body, "referenced"),
        vec![
            "images/haiga.jpg",
            "images/haiga.jpg/original.jpg",
            "images/haiga.jpg/thumb.jpg",
        ]
    );
    for key in [
        "images/haiga.jpg",
        "images/haiga.jpg/original.jpg",
        "images/haiga.jpg/thumb.jpg",
    ] {
        assert!(store.contains(key), "{key} must survive");
    }
}

#[tokio::test]
async fn gc_deletes_an_unreferenced_prefix_whole() {
    let (store, app) = setup_with(store_with_migrated_orphan());
    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    let expected = vec![
        "images/orphan.jpg/original.jpg".to_string(),
        "images/orphan.jpg/thumb.jpg".to_string(),
    ];
    assert_eq!(keys(&body, "orphaned"), expected);
    assert_eq!(keys(&body, "deleted"), expected);
    assert!(!store.contains("images/orphan.jpg/original.jpg"));
    assert!(!store.contains("images/orphan.jpg/thumb.jpg"));
}

#[tokio::test]
async fn gc_skips_a_whole_prefix_when_any_rendition_is_recent() {
    // An upload that stored its original and is still writing its thumbnail
    // must not have the original swept out from under it.
    let old = SystemTime::now() - Duration::from_secs(24 * 60 * 60);
    let (store, app) = setup_with(
        seeded_store()
            .with_object_modified_at("images/fresh.jpg/original.jpg", "original", old)
            .with_object_modified_at("images/fresh.jpg/thumb.jpg", "thumb", SystemTime::now()),
    );
    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        keys(&body, "skipped_recent"),
        vec!["images/fresh.jpg/original.jpg", "images/fresh.jpg/thumb.jpg"]
    );
    assert!(keys(&body, "deleted").is_empty());
    assert!(store.contains("images/fresh.jpg/original.jpg"));
}

#[tokio::test]
async fn gc_keeps_an_image_referenced_by_a_directory_layout_url() {
    // Published blog HTML rewritten by the migration points at
    // `/images/<id>/original.<ext>`; that must protect the whole prefix.
    let old = SystemTime::now() - Duration::from_secs(24 * 60 * 60);
    let (store, app) = setup_with(
        seeded_store()
            .with_object(
                // Overrides the seeded published post's content.
                "blog/post-2.html",
                r#"<img src="https://s3/images/rewritten.jpg/original.jpg">"#,
            )
            .with_object_modified_at("images/rewritten.jpg/original.jpg", "bytes", old)
            .with_object_modified_at("images/rewritten.jpg/thumb.jpg", "thumb", old),
    );
    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert!(keys(&body, "deleted").is_empty(), "body: {body}");
    assert!(store.contains("images/rewritten.jpg/original.jpg"));
}

#[tokio::test]
async fn gc_requires_auth() {
    let (_, app) = setup_with(store_with_orphan());
    let (status, _) = send(app, gc_request(Some(false), false)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn gc_defaults_to_dry_run_and_deletes_nothing() {
    let (store, app) = setup_with(store_with_orphan());

    let (status, body) = send(app, gc_request(None, true)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["dry_run"], json!(true));
    assert_eq!(keys(&body, "orphaned"), vec!["images/orphan.jpg"]);
    assert_eq!(
        keys(&body, "referenced"),
        vec!["images/blog-pub.jpg", "images/haiga.jpg"]
    );
    assert_eq!(keys(&body, "deleted"), Vec::<String>::new());
    assert!(
        store.contains("images/orphan.jpg"),
        "dry run must not delete anything"
    );
}

#[tokio::test]
async fn gc_explicit_dry_run_true_deletes_nothing() {
    let (store, app) = setup_with(store_with_orphan());
    let (status, body) = send(app, gc_request(Some(true), true)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(keys(&body, "deleted"), Vec::<String>::new());
    assert!(store.contains("images/orphan.jpg"));
}

#[tokio::test]
async fn gc_real_run_deletes_orphans_and_never_referenced_files() {
    let _trace = common::capture_tracing();
    let (store, app) = setup_with(store_with_orphan());

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["dry_run"], json!(false));
    assert_eq!(keys(&body, "deleted"), vec!["images/orphan.jpg"]);
    assert!(
        !store.contains("images/orphan.jpg"),
        "orphan should be gone"
    );
    // The invariant: every referenced object survives a real sweep.
    assert!(store.contains("images/haiga.jpg"));
    assert!(store.contains("images/blog-pub.jpg"));
}

#[tokio::test]
async fn gc_protects_references_from_all_manifest_sources() {
    // One image per source, all old; a real sweep must keep every one.
    let store = seeded_store()
        .with_object("images/haiga.jpg", "x")
        .with_object("images/home.jpg", "x")
        .with_object("images/background.jpg", "x")
        .with_object("images/photo1.jpg", "x")
        .with_object("images/photo2.jpg", "x")
        .with_object("images/blog-draft.png", "x")
        .with_object("images/blog-pub.jpg", "x");
    let (store, app) = setup_with(store);

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(keys(&body, "orphaned"), Vec::<String>::new());
    for key in [
        "images/haiga.jpg",
        "images/home.jpg",
        "images/background.jpg",
        "images/photo1.jpg",
        "images/photo2.jpg",
        "images/blog-draft.png",
        "images/blog-pub.jpg",
    ] {
        assert!(store.contains(key), "{key} must survive");
    }
}

#[tokio::test]
async fn gc_never_deletes_the_site_background_photo() {
    // The background photo is referenced ONLY by site-settings.json (no
    // other manifest mentions it); a real sweep must still keep it while
    // deleting a genuine orphan of the same age.
    let store = InMemoryStore::default()
        .with_object(
            "site-settings.json",
            json!({"backgroundPhoto": "bg.webp"}).to_string(),
        )
        .with_object("images/bg.webp", "background bytes")
        .with_object("images/orphan.jpg", "orphan bytes");
    let (store, app) = setup_with(store);

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(keys(&body, "referenced"), vec!["images/bg.webp"]);
    assert_eq!(keys(&body, "deleted"), vec!["images/orphan.jpg"]);
    assert!(
        store.contains("images/bg.webp"),
        "the site background must never be treated as an orphan"
    );
}

#[tokio::test]
async fn gc_aborts_when_site_settings_are_corrupt() {
    let store = store_with_orphan().with_object("site-settings.json", "{not json");
    let (store, app) = setup_with(store);

    let (status, _) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        store.contains("images/orphan.jpg"),
        "an aborted sweep must not have deleted anything"
    );
}

#[tokio::test]
async fn gc_aborts_when_site_settings_are_unreadable() {
    let (store, app) = setup_with(store_with_orphan());
    store.set_failing_get_for("site-settings.json");

    let (status, _) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(store.contains("images/orphan.jpg"));
}

#[tokio::test]
async fn gc_skips_recent_uploads_via_safety_margin() {
    // An unreferenced image uploaded moments ago may be part of an in-flight
    // upload-first save; it must be skipped, not deleted.
    let store = store_with_orphan().with_object_modified_at(
        "images/inflight.jpg",
        "fresh bytes",
        SystemTime::now(),
    );
    let (store, app) = setup_with(store);

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(keys(&body, "skipped_recent"), vec!["images/inflight.jpg"]);
    assert_eq!(keys(&body, "deleted"), vec!["images/orphan.jpg"]);
    assert!(store.contains("images/inflight.jpg"));
}

#[tokio::test]
async fn gc_deletes_unreferenced_objects_just_outside_the_margin() {
    let store = store_with_orphan().with_object_modified_at(
        "images/barely-old.jpg",
        "x",
        SystemTime::now() - Duration::from_secs(2 * 60 * 60),
    );
    let (store, app) = setup_with(store);

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert!(keys(&body, "deleted").contains(&"images/barely-old.jpg".to_string()));
    assert!(!store.contains("images/barely-old.jpg"));
}

#[tokio::test]
async fn gc_treats_unknown_last_modified_as_recent() {
    // When the backend reports no timestamp the sweep cannot prove the
    // object is old, so it must keep it.
    let store = store_with_orphan().with_object_untimestamped("images/no-mtime.jpg", "x");
    let (store, app) = setup_with(store);

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert!(keys(&body, "skipped_recent").contains(&"images/no-mtime.jpg".to_string()));
    assert!(store.contains("images/no-mtime.jpg"));
}

#[tokio::test]
async fn gc_ignores_bare_images_folder_marker() {
    // Some S3 tools create a zero-byte "images/" folder-marker object. It is
    // seeded old (outside the safety margin) and referenced by nothing, yet
    // it must be skipped entirely — not deleted, not even reported.
    let store = store_with_orphan().with_object("images/", "");
    let (store, app) = setup_with(store);

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert!(store.contains("images/"), "folder marker must survive");
    for field in ["referenced", "orphaned", "skipped_recent", "deleted"] {
        assert!(
            !keys(&body, field).contains(&"images/".to_string()),
            "{field} contained the folder marker"
        );
    }
}

#[tokio::test]
async fn gc_treats_future_last_modified_as_recent() {
    // Clock skew can put an object's last-modified in the future; the sweep
    // cannot prove such an object is old, so it must keep it.
    let store = store_with_orphan().with_object_modified_at(
        "images/from-the-future.jpg",
        "x",
        SystemTime::now() + Duration::from_secs(60 * 60),
    );
    let (store, app) = setup_with(store);

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    assert!(keys(&body, "skipped_recent").contains(&"images/from-the-future.jpg".to_string()));
    assert_eq!(keys(&body, "deleted"), vec!["images/orphan.jpg"]);
    assert!(store.contains("images/from-the-future.jpg"));
}

#[tokio::test]
async fn gc_delete_failure_partway_aborts_with_500_and_keeps_the_rest() {
    let _trace = common::capture_tracing();
    // Two old orphans, deleted in sorted order; the store fails after the
    // first delete. Everything already deleted was a proven orphan, so the
    // sweep reports the failure and leaves the rest for a re-run.
    let store = seeded_store()
        .with_object("images/haiga.jpg", "referenced bytes")
        .with_object("images/orphan-a.jpg", "x")
        .with_object("images/orphan-b.jpg", "x");
    store.set_failing_deletes_after(1);
    let (store, app) = setup_with(store);

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body,
        json!({"error": "Image GC: delete failed partway; re-run to finish"})
    );
    assert!(
        !store.contains("images/orphan-a.jpg"),
        "the delete that succeeded was a proven orphan"
    );
    assert!(
        store.contains("images/orphan-b.jpg"),
        "the failed delete must leave the object in place"
    );
    assert!(
        store.contains("images/haiga.jpg"),
        "referenced files survive"
    );
}

#[tokio::test]
async fn gc_aborts_with_500_when_a_manifest_is_unreadable_and_deletes_nothing() {
    let (store, app) = setup_with(store_with_orphan());
    store.set_failing_get_for("haiga.json");

    let (status, _) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        store.contains("images/orphan.jpg"),
        "an aborted sweep must not have deleted anything"
    );
}

#[tokio::test]
async fn gc_aborts_with_500_when_a_manifest_is_corrupt_and_deletes_nothing() {
    let store = store_with_orphan().with_object("photography.json", "definitely not json");
    let (store, app) = setup_with(store);

    let (status, _) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(store.contains("images/orphan.jpg"));
}

#[tokio::test]
async fn gc_aborts_with_500_when_blog_content_is_unreadable_and_deletes_nothing() {
    let (store, app) = setup_with(store_with_orphan());
    store.set_failing_get_for("blog/post-1.html");

    let (status, _) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(store.contains("images/orphan.jpg"));
}

#[tokio::test]
async fn gc_ignores_objects_outside_the_images_prefix() {
    let (store, app) = setup_with(store_with_orphan());

    let (status, body) = send(app, gc_request(Some(false), true)).await;

    assert_eq!(status, StatusCode::OK);
    // Manifests and blog content live outside images/ and must be untouched
    // and unreported.
    assert!(store.contains("haiga.json"));
    assert!(store.contains("blog/post-1.html"));
    for field in ["referenced", "orphaned", "skipped_recent", "deleted"] {
        for key in keys(&body, field) {
            assert!(key.starts_with("images/"), "{field} contained {key}");
        }
    }
}
