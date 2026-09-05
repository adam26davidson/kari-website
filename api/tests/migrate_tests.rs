//! Tests for `migrate_images`, the one-shot backfill that moves an existing
//! bucket to the directory-per-image layout (#273).
//!
//! Everything runs against the in-memory store, so the same code path the
//! `migrate-images` subcommand runs against a real bucket is exercised here
//! — including the two things that make the migration safe to run twice:
//! it never copies over an existing original, and it never rewrites HTML
//! that is already rewritten.

mod common;

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use common::store::InMemoryStore;
use kari_website_api::migrate::{migrate_images, run_migrate_images_command};
use kari_website_api::services::object_store::ObjectStore;
use serde_json::json;

/// A real encoded PNG, so the thumbnail step has bytes it can decode.
fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(width, height, |x, _| {
        image::Rgb([(x % 256) as u8, 10, 60])
    }));
    let mut out = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png encodes");
    out
}

fn old() -> SystemTime {
    SystemTime::now() - Duration::from_secs(24 * 60 * 60)
}

/// A bucket in the pre-migration layout: one legacy image object, a
/// published post whose HTML points at it through S3, and a draft post whose
/// HTML points at it through the API.
fn legacy_store() -> InMemoryStore {
    InMemoryStore::default()
        .with_object_tagged("images/pub.png", png_bytes(1200, 800), true, old())
        .with_object(
            "blog-posts-all.json",
            json!([
                {"id": "post-pub", "title": "t", "date": "d", "isPublished": true},
                {"id": "post-draft", "title": "t", "date": "d", "isPublished": false},
            ])
            .to_string(),
        )
        .with_object(
            "blog/post-pub.html",
            r#"<img src="https://s3.example.com/images/pub.png">"#,
        )
        .with_object(
            "blog/post-draft.html",
            r#"<img src="http://localhost:3000/images/pub.png">"#,
        )
}

#[tokio::test]
async fn dry_run_changes_nothing_but_reports_the_work() {
    let store = Arc::new(legacy_store());
    let report = migrate_images(store.as_ref(), true)
        .await
        .expect("migration should succeed");

    assert_eq!(report.copied, vec!["images/pub.png/original.png"]);
    assert_eq!(
        report.variants_written,
        vec!["images/pub.png/thumb.jpg", "images/pub.png/background.jpg"]
    );
    assert_eq!(report.rewritten, vec!["blog/post-pub.html"]);
    assert!(report.failed_variants.is_empty());
    // Nothing was written.
    assert!(!store.contains("images/pub.png/original.png"));
    assert!(!store.contains("images/pub.png/thumb.jpg"));
    assert!(!store.contains("images/pub.png/background.jpg"));
    assert_eq!(
        String::from_utf8(store.get("blog/post-pub.html").unwrap().data).unwrap(),
        r#"<img src="https://s3.example.com/images/pub.png">"#
    );
}

#[tokio::test]
async fn apply_copies_the_original_preserving_visibility() {
    let store = Arc::new(legacy_store().with_object_tagged(
        "images/priv.png",
        png_bytes(60, 40),
        false,
        old(),
    ));
    migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    let public = store.get("images/pub.png/original.png").expect("copied");
    assert_eq!(public.data, png_bytes(1200, 800));
    assert!(public.public);
    // A private image's copy — and its renditions — stay private.
    assert!(!store.get("images/priv.png/original.png").unwrap().public);
    assert!(!store.get("images/priv.png/thumb.jpg").unwrap().public);
    assert!(!store.get("images/priv.png/background.jpg").unwrap().public);
    // Copy-only: the legacy object stays so the pre-deploy code keeps working.
    assert!(store.contains("images/pub.png"));
}

#[tokio::test]
async fn apply_generates_a_thumbnail_for_every_image() {
    let store = Arc::new(legacy_store());
    migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    let thumb = store.get("images/pub.png/thumb.jpg").expect("thumbnail");
    let decoded = image::load_from_memory(&thumb.data).expect("thumbnail decodes");
    assert_eq!((decoded.width(), decoded.height()), (480, 320));
}

#[tokio::test]
async fn apply_generates_a_background_rendition_for_every_image() {
    let store = Arc::new(legacy_store());
    migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    let background = store
        .get("images/pub.png/background.jpg")
        .expect("background");
    assert!(background.public, "a public image's background is public");
    let decoded = image::load_from_memory(&background.data).expect("background decodes");
    // 1200x800 is already inside BACKGROUND_MAX_EDGE, so it keeps its size —
    // the background is a re-encode, not an enlargement.
    assert_eq!((decoded.width(), decoded.height()), (1200, 800));
    assert_eq!(
        image::guess_format(&background.data).expect("format"),
        image::ImageFormat::Jpeg
    );
}

#[tokio::test]
async fn apply_backfills_a_thumbnail_for_an_already_copied_image() {
    // A bucket half-migrated by an interrupted run: the original is in place
    // but the renditions never got written.
    let store = Arc::new(InMemoryStore::default().with_object_tagged(
        "images/only.png/original.png",
        png_bytes(300, 300),
        true,
        old(),
    ));
    let report = migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    assert!(report.copied.is_empty(), "nothing to copy");
    assert_eq!(
        report.variants_written,
        vec![
            "images/only.png/thumb.jpg",
            "images/only.png/background.jpg"
        ]
    );
    assert!(store.contains("images/only.png/thumb.jpg"));
    assert!(store.contains("images/only.png/background.jpg"));
}

#[tokio::test]
async fn apply_backfills_only_the_variant_a_migrated_image_is_missing() {
    // The state every already-migrated bucket is in when a NEW variant
    // ships: original and thumbnail in place, background not yet.
    let store = Arc::new(
        InMemoryStore::default()
            .with_object_tagged(
                "images/done.png/original.png",
                png_bytes(300, 300),
                false,
                old(),
            )
            .with_object_tagged("images/done.png/thumb.jpg", png_bytes(48, 48), false, old()),
    );
    let thumb_before = store.get("images/done.png/thumb.jpg").unwrap().data;

    let report = migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    assert_eq!(
        report.variants_written,
        vec!["images/done.png/background.jpg"]
    );
    // The existing thumbnail is left exactly as it was.
    assert_eq!(
        store.get("images/done.png/thumb.jpg").unwrap().data,
        thumb_before
    );
    // Visibility is inherited from the original, not assumed public.
    assert!(!store.get("images/done.png/background.jpg").unwrap().public);
}

#[tokio::test]
async fn apply_rewrites_published_html_and_leaves_drafts_alone() {
    let store = Arc::new(legacy_store());
    migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    assert_eq!(
        String::from_utf8(store.get("blog/post-pub.html").unwrap().data).unwrap(),
        r#"<img src="https://s3.example.com/images/pub.png/original.png">"#
    );
    // Drafts are served through the API, which resolves the id itself.
    assert_eq!(
        String::from_utf8(store.get("blog/post-draft.html").unwrap().data).unwrap(),
        r#"<img src="http://localhost:3000/images/pub.png">"#
    );
}

#[tokio::test]
async fn apply_leaves_an_unknown_image_reference_untouched() {
    // An id with no object in the bucket (already GC'd, or hand-edited HTML)
    // must not be rewritten into a key that certainly does not exist.
    let store = Arc::new(legacy_store().with_object(
        "blog/post-pub.html",
        r#"<img src="https://s3/images/gone.png"><img src="https://s3/images/pub.png">"#,
    ));
    migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    assert_eq!(
        String::from_utf8(store.get("blog/post-pub.html").unwrap().data).unwrap(),
        r#"<img src="https://s3/images/gone.png"><img src="https://s3/images/pub.png/original.png">"#
    );
}

#[tokio::test]
async fn running_twice_is_the_same_as_running_once() {
    let store = Arc::new(legacy_store());
    migrate_images(store.as_ref(), false).await.expect("first");
    let after_first = store.get("images/pub.png/thumb.jpg").unwrap().data;

    let report = migrate_images(store.as_ref(), false).await.expect("second");

    assert!(report.copied.is_empty(), "nothing left to copy");
    assert!(
        report.variants_written.is_empty(),
        "nothing left to generate"
    );
    assert!(report.rewritten.is_empty(), "nothing left to rewrite");
    assert_eq!(
        store.get("images/pub.png/thumb.jpg").unwrap().data,
        after_first
    );
    assert_eq!(
        String::from_utf8(store.get("blog/post-pub.html").unwrap().data).unwrap(),
        r#"<img src="https://s3.example.com/images/pub.png/original.png">"#
    );
}

#[tokio::test]
async fn an_undecodable_original_is_reported_and_does_not_abort() {
    let _tracing = common::capture_tracing();
    let store = Arc::new(legacy_store().with_object_tagged(
        "images/broken.png",
        "NOT AN IMAGE",
        true,
        old(),
    ));
    let report = migrate_images(store.as_ref(), false)
        .await
        .expect("migration should still succeed");

    // One line per rendition that could not be produced.
    assert_eq!(report.failed_variants.len(), 2);
    assert!(
        report
            .failed_variants
            .iter()
            .all(|line| line.contains("broken.png")),
        "got: {:?}",
        report.failed_variants
    );
    // Its original was still copied, and the healthy image is untouched by
    // the failure.
    assert!(store.contains("images/broken.png/original.png"));
    assert!(store.contains("images/pub.png/thumb.jpg"));
    assert!(store.contains("images/pub.png/background.jpg"));
}

#[tokio::test]
async fn a_failed_copy_aborts_the_migration() {
    let store = Arc::new(legacy_store().with_object_tagged(
        "images/second.png",
        png_bytes(80, 80),
        true,
        old(),
    ));
    store.set_failing_copies_after(0);

    let err = migrate_images(store.as_ref(), false)
        .await
        .expect_err("a failed copy must abort");

    assert!(err.to_string().contains("copy"), "got: {err}");
    // Aborted before any HTML was rewritten.
    assert_eq!(
        String::from_utf8(store.get("blog/post-pub.html").unwrap().data).unwrap(),
        r#"<img src="https://s3.example.com/images/pub.png">"#
    );
}

#[tokio::test]
async fn a_missing_blog_list_is_not_an_error() {
    // A fresh site has no posts at all; the image half of the migration must
    // still run.
    let store = Arc::new(InMemoryStore::default().with_object_tagged(
        "images/a.png",
        png_bytes(50, 50),
        true,
        old(),
    ));
    let report = migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    assert_eq!(report.copied, vec!["images/a.png/original.png"]);
    assert!(report.rewritten.is_empty());
}

#[tokio::test]
async fn an_unreadable_blog_list_aborts_the_migration() {
    let store = Arc::new(legacy_store());
    store.set_failing_get_for("blog-posts-all.json");

    let err = migrate_images(store.as_ref(), false)
        .await
        .expect_err("an unreadable list must abort");

    assert!(
        err.to_string().contains("blog-posts-all.json"),
        "got: {err}"
    );
}

#[tokio::test]
async fn the_bare_images_folder_marker_is_ignored() {
    let store = Arc::new(InMemoryStore::default().with_object("images/", ""));
    let report = migrate_images(store.as_ref(), false)
        .await
        .expect("migration should succeed");

    assert!(report.copied.is_empty());
    assert!(report.variants_written.is_empty());
    assert_eq!(
        store.list_objects("images/").await.unwrap().len(),
        1,
        "the marker itself is left alone"
    );
}

// ------------------------------------------------- the CLI entry point

/// Run the subcommand as `main` would, with the given `AWS_ENDPOINT_URL`
/// (empty for "targeting real AWS").
async fn run_command(store: &InMemoryStore, args: &[&str], endpoint: &str) -> i32 {
    let argv: Vec<String> = std::iter::once("migrate-images".to_string())
        .chain(args.iter().map(|a| a.to_string()))
        .collect();
    run_migrate_images_command(store, &argv, endpoint).await
}

#[tokio::test]
async fn the_command_defaults_to_a_dry_run() {
    let store = legacy_store();
    assert_eq!(run_command(&store, &[], "").await, 0);
    assert!(
        !store.contains("images/pub.png/original.png"),
        "a dry run must not write"
    );
}

#[tokio::test]
async fn the_command_writes_only_with_apply() {
    let store = legacy_store();
    assert_eq!(run_command(&store, &["--apply"], "").await, 0);
    assert!(store.contains("images/pub.png/original.png"));
}

#[tokio::test]
async fn the_command_refuses_a_local_endpoint_without_allow_local() {
    // api/.env points at the dev stack's MinIO, and dotenv loads it before
    // the subcommand runs — migrating a dev stack while believing you are
    // migrating a real bucket must not be one typo away.
    let store = legacy_store();
    assert_eq!(
        run_command(&store, &["--apply"], "http://localhost:9000").await,
        2
    );
    assert!(!store.contains("images/pub.png/original.png"));
}

#[tokio::test]
async fn the_command_rehearses_against_a_local_endpoint_when_allowed() {
    let store = legacy_store();
    assert_eq!(
        run_command(
            &store,
            &["--apply", "--allow-local"],
            "http://127.0.0.1:9000"
        )
        .await,
        0
    );
    assert!(store.contains("images/pub.png/original.png"));
}

#[tokio::test]
async fn the_command_reports_a_failed_migration_as_a_nonzero_exit() {
    let store = legacy_store();
    store.set_failing(true);
    assert_eq!(run_command(&store, &["--apply"], "").await, 1);
}
