//! Handler-level tests for every route, driven through the REAL router (auth
//! layer included) with an in-memory `ObjectStore` standing in for S3.
//!
//! Each handler is exercised on its success path plus the paths that matter
//! operationally: object missing, stored data corrupt, and S3 failing
//! outright. Requests to secure routes carry a token signed with the test key
//! from `common`, so the real auth middleware runs on every request.

mod common;

use std::sync::Arc;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use common::store::{state_with_store, InMemoryStore};
use common::{build_jwks, signed_token, TokenOptions};
use http_body_util::BodyExt;
use kari_website_api::routes::create_router;
use kari_website_api::services::image_keys::{original_key, variant_key, ImageVariant};
use kari_website_api::services::object_store::ObjectStore;
use serde_json::{json, Value};
use tower::ServiceExt;

fn setup() -> (Arc<InMemoryStore>, axum::Router) {
    setup_with(InMemoryStore::default())
}

fn setup_with(store: InMemoryStore) -> (Arc<InMemoryStore>, axum::Router) {
    let store = Arc::new(store);
    let app = create_router(state_with_store(build_jwks(), store.clone()));
    (store, app)
}

fn bearer() -> String {
    format!("Bearer {}", signed_token(TokenOptions::default()))
}

fn get(uri: &str) -> Request<Body> {
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

fn get_auth(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .body(Body::empty())
        .unwrap()
}

fn put_json(uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn put_auth(uri: &str) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .body(Body::empty())
        .unwrap()
}

fn delete_auth(uri: &str) -> Request<Body> {
    Request::builder()
        .method("DELETE")
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .body(Body::empty())
        .unwrap()
}

const BOUNDARY: &str = "test-boundary";

/// Build a multipart POST to /images. `filename: None` sends a field with no
/// filename so the handler falls back to its default key.
fn multipart_upload(uri: &str, filename: Option<&str>, bytes: &[u8]) -> Request<Body> {
    let disposition = match filename {
        Some(name) => format!("form-data; name=\"file\"; filename=\"{name}\""),
        None => "form-data; name=\"file\"".to_string(),
    };
    let mut body = Vec::new();
    body.extend_from_slice(
        format!("--{BOUNDARY}\r\nContent-Disposition: {disposition}\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    multipart_request(uri, body)
}

fn multipart_request(uri: &str, body: Vec<u8>) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::AUTHORIZATION, bearer())
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap()
}

/// Run a request and return (status, parsed JSON body).
async fn send(app: axum::Router, req: Request<Body>) -> (StatusCode, Value) {
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

// ---------------------------------------------------------------- haiku

fn sample_haiku() -> Value {
    json!([{"id": "h1", "lines": ["old pond", "a frog leaps in", "water's sound"], "publisher": "basho"}])
}

#[tokio::test]
async fn get_haiku_returns_empty_list_when_absent() {
    let (_, app) = setup();
    assert_eq!(send(app, get("/haiku")).await, (StatusCode::OK, json!([])));
}

#[tokio::test]
async fn haiku_round_trips_through_store() {
    let (store, app) = setup();
    let (status, body) = send(app.clone(), put_json("/haiku", sample_haiku())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Haiku list updated"}));
    // Content data is written world-readable (public=true tag).
    assert!(store.get("haiku.json").expect("stored").public);
    assert_eq!(
        send(app, get("/haiku")).await,
        (StatusCode::OK, sample_haiku())
    );
}

#[tokio::test]
async fn get_haiku_corrupt_data_is_500_not_empty_list() {
    let (_, app) = setup_with(InMemoryStore::default().with_object("haiku.json", "not json"));
    let (status, body) = send(app, get("/haiku")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Stored haiku data is invalid"}));
}

#[tokio::test]
async fn get_haiku_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get("/haiku")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to fetch haiku"}));
}

#[tokio::test]
async fn update_haiku_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, put_json("/haiku", sample_haiku())).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to update haiku"}));
}

// ---------------------------------------------------------------- haiga

fn sample_haiga() -> Value {
    json!([{"id": "g1", "lines": ["winter moon"], "publisher": "buson", "image": "moon.jpg"}])
}

#[tokio::test]
async fn get_haiga_returns_empty_list_when_absent() {
    let (_, app) = setup();
    assert_eq!(send(app, get("/haiga")).await, (StatusCode::OK, json!([])));
}

#[tokio::test]
async fn haiga_round_trips_through_store() {
    let (store, app) = setup();
    let (status, body) = send(app.clone(), put_json("/haiga", sample_haiga())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Haiga list updated"}));
    assert!(store.get("haiga.json").expect("stored").public);
    assert_eq!(
        send(app, get("/haiga")).await,
        (StatusCode::OK, sample_haiga())
    );
}

#[tokio::test]
async fn get_haiga_corrupt_data_is_500_not_empty_list() {
    let (_, app) = setup_with(InMemoryStore::default().with_object("haiga.json", "{broken"));
    let (status, body) = send(app, get("/haiga")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Stored haiga data is invalid"}));
}

#[tokio::test]
async fn get_haiga_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get("/haiga")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to fetch haiga"}));
}

#[tokio::test]
async fn update_haiga_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, put_json("/haiga", sample_haiga())).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to update haiga"}));
}

// ---------------------------------------------------------------- photography

fn sample_photography() -> Value {
    json!([{
        "id": "p1",
        "title": "Coast",
        "subtitle": "Oregon",
        "blurb": "fog",
        "images": [{"image": "coast.jpg", "blurb": "dunes"}]
    }])
}

#[tokio::test]
async fn get_photography_requires_auth() {
    let (_, app) = setup();
    let (status, _) = send(app, get("/photography")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn get_photography_returns_empty_list_when_absent() {
    let (_, app) = setup();
    assert_eq!(
        send(app, get_auth("/photography")).await,
        (StatusCode::OK, json!([]))
    );
}

#[tokio::test]
async fn photography_round_trips_through_store() {
    let (store, app) = setup();
    let (status, body) = send(app.clone(), put_json("/photography", sample_photography())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Photography posts updated"}));
    assert!(store.get("photography.json").expect("stored").public);
    assert_eq!(
        send(app, get_auth("/photography")).await,
        (StatusCode::OK, sample_photography())
    );
}

#[tokio::test]
async fn get_photography_corrupt_data_is_500_not_empty_list() {
    let (_, app) = setup_with(InMemoryStore::default().with_object("photography.json", "[42]"));
    let (status, body) = send(app, get_auth("/photography")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Stored photography data is invalid"}));
}

#[tokio::test]
async fn get_photography_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get_auth("/photography")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to fetch photography"}));
}

#[tokio::test]
async fn update_photography_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, put_json("/photography", sample_photography())).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to update photography posts"}));
}

// ---------------------------------------------------------------- home page

#[tokio::test]
async fn get_home_page_is_blank_when_absent() {
    let (_, app) = setup();
    assert_eq!(
        send(app, get("/home-page")).await,
        (StatusCode::OK, json!({"photo": "", "blurb": ""}))
    );
}

#[tokio::test]
async fn home_page_round_trips_through_store() {
    let (store, app) = setup();
    let data = json!({"photo": "kari.jpg", "blurb": "welcome"});
    let (status, body) = send(app.clone(), put_json("/home-page", data.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Home page data updated"}));
    assert!(store.get("home-page.json").expect("stored").public);
    assert_eq!(send(app, get("/home-page")).await, (StatusCode::OK, data));
}

#[tokio::test]
async fn get_home_page_corrupt_data_is_500() {
    let (_, app) = setup_with(InMemoryStore::default().with_object("home-page.json", "nope"));
    let (status, body) = send(app, get("/home-page")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Stored home page data is invalid"}));
}

#[tokio::test]
async fn get_home_page_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get("/home-page")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to fetch home page data"}));
}

#[tokio::test]
async fn update_home_page_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(
        app,
        put_json("/home-page", json!({"photo": "", "blurb": ""})),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to update home page data"}));
}

// ---------------------------------------------------------------- site settings

/// Every settings field at its default — what a bucket with no
/// site-settings.json, and every object written before a field existed,
/// answers with.
fn default_site_settings() -> serde_json::Value {
    json!({
        "backgroundPhoto": "",
        "headerBackgroundColor": "",
        "headerTitleColor": "",
        "headerNavColor": "",
        "fontPairing": "",
    })
}

#[tokio::test]
async fn get_site_settings_is_default_when_absent() {
    let (_, app) = setup();
    assert_eq!(
        send(app, get("/site-settings")).await,
        (StatusCode::OK, default_site_settings())
    );
}

#[tokio::test]
async fn site_settings_round_trip_through_store() {
    let (store, app) = setup();
    let data = json!({
        "backgroundPhoto": "bg.webp",
        "headerBackgroundColor": "#123456cc",
        "headerTitleColor": "#ffeedd",
        "headerNavColor": "#001122",
        "fontPairing": "shippori",
    });
    let (status, body) = send(app.clone(), put_json("/site-settings", data.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Site settings updated"}));
    // The public site fetches site-settings.json straight from S3, so the
    // object must be stored public.
    assert!(store.get("site-settings.json").expect("stored").public);
    assert_eq!(
        send(app, get("/site-settings")).await,
        (StatusCode::OK, data)
    );
}

#[tokio::test]
async fn get_site_settings_tolerates_missing_background_field() {
    // A future settings object written without backgroundPhoto must still
    // parse (the field defaults) — a 500 here would also brick the GC sweep.
    let (_, app) = setup_with(InMemoryStore::default().with_object("site-settings.json", "{}"));
    assert_eq!(
        send(app, get("/site-settings")).await,
        (StatusCode::OK, default_site_settings())
    );
}

#[tokio::test]
async fn get_site_settings_tolerates_a_legacy_object_without_appearance_fields() {
    // Everything stored before the header colours and the font pairing
    // existed is this shape. It has to keep parsing — a 500 here would
    // brick the GC sweep too — and every missing field has to read back as
    // "use the defaults".
    let (_, app) = setup_with(
        InMemoryStore::default()
            .with_object("site-settings.json", r#"{"backgroundPhoto":"bg.webp"}"#),
    );
    let mut expected = default_site_settings();
    expected["backgroundPhoto"] = json!("bg.webp");
    assert_eq!(
        send(app, get("/site-settings")).await,
        (StatusCode::OK, expected)
    );
}

#[tokio::test]
async fn get_site_settings_corrupt_data_is_500() {
    let (_, app) = setup_with(InMemoryStore::default().with_object("site-settings.json", "nope"));
    let (status, body) = send(app, get("/site-settings")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Stored site settings are invalid"}));
}

#[tokio::test]
async fn get_site_settings_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get("/site-settings")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to fetch site settings"}));
}

#[tokio::test]
async fn update_site_settings_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(
        app,
        put_json("/site-settings", json!({"backgroundPhoto": ""})),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to update site settings"}));
}

// ---------------------------------------------------------------- image list

#[tokio::test]
async fn list_images_returns_ids_newest_first_without_folder_marker() {
    use std::time::{Duration, SystemTime};
    let now = SystemTime::now();
    let store = InMemoryStore::default()
        .with_object_modified_at(
            "images/older.jpg/original.jpg",
            "x",
            now - Duration::from_secs(300),
        )
        .with_object_modified_at("images/newest.webp/original.webp", "x", now)
        .with_object_modified_at(
            "images/oldest.png/original.png",
            "x",
            now - Duration::from_secs(600),
        )
        // The bare folder marker and non-image objects must not appear.
        .with_object("images/", "")
        .with_object("home-page.json", "{}");
    let (_, app) = setup_with(store);

    let (status, body) = send(app, get_auth("/images")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"images": ["newest.webp", "older.jpg", "oldest.png"]})
    );
}

#[tokio::test]
async fn list_images_reports_each_id_once_across_both_layouts() {
    use std::time::{Duration, SystemTime};
    let now = SystemTime::now();
    // A migrated image (prefix with two objects), plus one that has not been
    // migrated yet — each must appear exactly once, and a prefix is as new as
    // its newest object.
    let store = InMemoryStore::default()
        .with_object_modified_at(
            "images/a.jpg/original.jpg",
            "x",
            now - Duration::from_secs(600),
        )
        .with_object_modified_at("images/a.jpg/thumb.jpg", "x", now)
        .with_object_modified_at("images/b.png", "x", now - Duration::from_secs(300));
    let (_, app) = setup_with(store);

    assert_eq!(
        send(app, get_auth("/images")).await,
        (StatusCode::OK, json!({"images": ["a.jpg", "b.png"]}))
    );
}

#[tokio::test]
async fn list_images_is_empty_when_none_uploaded() {
    let (_, app) = setup();
    assert_eq!(
        send(app, get_auth("/images")).await,
        (StatusCode::OK, json!({"images": []}))
    );
}

#[tokio::test]
async fn list_images_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get_auth("/images")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to list images"}));
}

// ---------------------------------------------------------------- blog

fn sample_blog_posts() -> Value {
    json!([{"id": "b1", "title": "Hello", "date": "2026-08-04", "isPublished": true}])
}

fn mixed_blog_posts() -> Value {
    json!([
        {"id": "b1", "title": "Hello", "date": "2026-08-04", "isPublished": true},
        {"id": "b2", "title": "Secret draft", "date": "2026-08-05", "isPublished": false}
    ])
}

#[tokio::test]
async fn update_blog_posts_splits_private_full_and_public_published_lists() {
    let (store, app) = setup();
    let (status, _) = send(app, put_json("/blog", mixed_blog_posts())).await;
    assert_eq!(status, StatusCode::OK);

    // Full list, drafts included, must be stored privately.
    let all = store
        .get("blog-posts-all.json")
        .expect("private list stored");
    assert!(!all.public);
    assert_eq!(
        serde_json::from_slice::<Value>(&all.data).unwrap(),
        mixed_blog_posts()
    );

    // The public object must contain ONLY published posts (this is the leak).
    let public = store.get("blog-posts.json").expect("public list stored");
    assert!(public.public);
    assert_eq!(
        serde_json::from_slice::<Value>(&public.data).unwrap(),
        json!([{"id": "b1", "title": "Hello", "date": "2026-08-04", "isPublished": true}])
    );
}

#[tokio::test]
async fn list_blog_posts_returns_empty_list_when_absent() {
    let (_, app) = setup();
    assert_eq!(
        send(app, get_auth("/blog")).await,
        (StatusCode::OK, json!([]))
    );
}

#[tokio::test]
async fn blog_posts_round_trip_preserving_wire_format() {
    let (store, app) = setup();
    let (status, body) = send(app.clone(), put_json("/blog", sample_blog_posts())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Blog posts updated"}));
    assert!(store.get("blog-posts.json").expect("stored").public);
    // The camelCase `isPublished` contract with the frontend must survive the
    // round trip.
    assert_eq!(
        send(app, get_auth("/blog")).await,
        (StatusCode::OK, sample_blog_posts())
    );
}

#[tokio::test]
async fn list_blog_posts_corrupt_data_is_500_not_empty_list() {
    let (_, app) = setup_with(InMemoryStore::default().with_object("blog-posts-all.json", "oops"));
    let (status, body) = send(app, get_auth("/blog")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Stored blog post data is invalid"}));
}

#[tokio::test]
async fn list_blog_posts_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get_auth("/blog")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to fetch blog posts"}));
}

#[tokio::test]
async fn list_blog_posts_returns_drafts_after_split_write() {
    let (_, app) = setup();
    send(app.clone(), put_json("/blog", mixed_blog_posts())).await;
    // The admin list must come from the private full list, drafts included —
    // not the filtered public object.
    assert_eq!(
        send(app, get_auth("/blog")).await,
        (StatusCode::OK, mixed_blog_posts())
    );
}

#[tokio::test]
async fn list_blog_posts_ignores_public_object_when_private_missing() {
    // A missing private object must NOT fall back to the filtered public
    // list (the pre-#33 migration bridge): serving it would show the admin a
    // draft-less list, and the next save would persist it, wiping drafts.
    let public_only = json!([
        {"id": "b1", "title": "Hello", "date": "2026-08-04", "isPublished": true}
    ]);
    let (_, app) = setup_with(
        InMemoryStore::default().with_object("blog-posts.json", public_only.to_string()),
    );
    assert_eq!(
        send(app, get_auth("/blog")).await,
        (StatusCode::OK, json!([]))
    );
}

#[tokio::test]
async fn update_blog_posts_public_write_failure_is_500_after_private_write() {
    // The private (all-posts) write succeeds, then the outage begins and the
    // public write fails. Private-first ordering means nothing draft-related
    // was exposed and the full list is already saved.
    let (store, app) = setup();
    store.set_failing_puts_after(1);
    let (status, body) = send(app, put_json("/blog", mixed_blog_posts())).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to update public blog posts"}));
    assert!(store.contains("blog-posts-all.json"));
    assert!(!store.contains("blog-posts.json"));
}

#[tokio::test]
async fn get_blog_post_content_invalid_utf8_is_500() {
    let (_, app) =
        setup_with(InMemoryStore::default().with_object("blog/b1.html", vec![0xff, 0xfe, 0xfd]));
    let (status, body) = send(app, get_auth("/blog-content/b1")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body,
        json!({"error": "Stored blog post content is invalid"})
    );
}

#[tokio::test]
async fn update_blog_posts_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, put_json("/blog", sample_blog_posts())).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to update blog posts"}));
}

#[tokio::test]
async fn blog_post_content_stores_html_with_publish_flag() {
    let (store, app) = setup();
    let update = json!({"id": "b1", "content": "<p>hi</p>", "isPublished": false});
    let (status, body) = send(app, put_json("/blog-content", update)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Blog post content updated"}));
    let stored = store.get("blog/b1.html").expect("stored");
    assert_eq!(stored.data, b"<p>hi</p>");
    // Draft content must NOT be tagged public.
    assert!(!stored.public);
}

#[tokio::test]
async fn get_blog_post_content_returns_stored_html() {
    let (_, app) = setup_with(InMemoryStore::default().with_object("blog/b1.html", "<p>hi</p>"));
    assert_eq!(
        send(app, get_auth("/blog-content/b1")).await,
        (StatusCode::OK, json!({"content": "<p>hi</p>"}))
    );
}

#[tokio::test]
async fn get_blog_post_content_missing_is_404() {
    let (_, app) = setup();
    let (status, body) = send(app, get_auth("/blog-content/missing")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({"error": "Blog post content not found"}));
}

#[tokio::test]
async fn get_blog_post_content_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get_auth("/blog-content/b1")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to fetch blog post content"}));
}

#[tokio::test]
async fn update_blog_post_content_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let update = json!({"id": "b1", "content": "<p>hi</p>", "isPublished": true});
    let (status, body) = send(app, put_json("/blog-content", update)).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to update blog post content"}));
}

#[tokio::test]
async fn delete_blog_post_content_removes_object() {
    let (store, app) = setup_with(InMemoryStore::default().with_object("blog/b1.html", "<p>x</p>"));
    let (status, body) = send(app, delete_auth("/blog-content/b1")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Blog post deleted"}));
    assert!(!store.contains("blog/b1.html"));
}

#[tokio::test]
async fn delete_blog_post_content_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, delete_auth("/blog-content/b1")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to delete blog post"}));
}

// ---------------------------------------------------------------- images

/// Run a GET and return (status, content-type, body bytes).
async fn get_bytes(app: axum::Router, uri: &str) -> (StatusCode, String, Vec<u8>) {
    let response = app.oneshot(get(uri)).await.unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|value| value.to_str().unwrap().to_string())
        .unwrap_or_default();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, content_type, bytes.to_vec())
}

#[tokio::test]
async fn get_image_serves_the_original_with_guessed_content_type() {
    let png = vec![0x89u8, b'P', b'N', b'G'];
    let (_, app) = setup_with(
        InMemoryStore::default().with_object("images/photo.png/original.png", png.clone()),
    );

    let (status, content_type, bytes) = get_bytes(app, "/images/photo.png").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "image/png");
    assert_eq!(bytes, png);
}

#[tokio::test]
async fn get_image_size_thumb_serves_the_thumbnail_as_jpeg() {
    let (_, app) = setup_with(
        InMemoryStore::default()
            .with_object("images/photo.png/original.png", "ORIGINAL")
            .with_object("images/photo.png/thumb.jpg", "THUMB"),
    );

    let (status, content_type, bytes) = get_bytes(app, "/images/photo.png?size=thumb").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "image/jpeg");
    assert_eq!(bytes, b"THUMB");
}

#[tokio::test]
async fn get_image_size_thumb_falls_back_to_the_original_when_no_thumbnail_exists() {
    // Covers both a not-yet-migrated image and one whose thumbnail could not
    // be generated: the admin sees the (slower) original, never a broken tile.
    let (_, app) = setup_with(
        InMemoryStore::default().with_object("images/photo.png/original.png", "ORIGINAL"),
    );

    let (status, content_type, bytes) = get_bytes(app, "/images/photo.png?size=thumb").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "image/png");
    assert_eq!(bytes, b"ORIGINAL");
}

#[tokio::test]
async fn get_image_falls_back_to_the_legacy_single_object_layout() {
    // Pre-migration buckets still store one object per image; both the
    // default and the thumbnail request must serve it.
    for uri in ["/images/photo.png", "/images/photo.png?size=thumb"] {
        let (_, app) =
            setup_with(InMemoryStore::default().with_object("images/photo.png", "LEGACY"));
        let (status, content_type, bytes) = get_bytes(app, uri).await;
        assert_eq!(status, StatusCode::OK, "for {uri}");
        assert_eq!(content_type, "image/png", "for {uri}");
        assert_eq!(bytes, b"LEGACY", "for {uri}");
    }
}

#[tokio::test]
async fn get_image_with_an_unknown_size_is_400() {
    let (_, app) = setup_with(
        InMemoryStore::default().with_object("images/photo.png/original.png", "ORIGINAL"),
    );
    let (status, body) = send(app, get("/images/photo.png?size=enormous")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"error": "Unknown image size"}));
}

#[tokio::test]
async fn get_image_missing_is_404() {
    let (_, app) = setup();
    let (status, body) = send(app, get("/images/missing.png")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({"error": "Image not found"}));
}

#[tokio::test]
async fn get_image_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, get("/images/photo.png")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to fetch image"}));
}

/// Pull the server-generated file name out of an upload response and check
/// its shape: a fresh UUID plus the expected (sanitized) extension. Returns
/// the name so tests can look the object up in the store.
fn uploaded_file_name(body: &Value, expected_extension: &str) -> String {
    let name = body["fileName"].as_str().expect("fileName in response");
    let stem = name
        .strip_suffix(expected_extension)
        .unwrap_or_else(|| panic!("{name:?} should end with {expected_extension:?}"));
    uuid::Uuid::parse_str(stem).unwrap_or_else(|_| panic!("{stem:?} should be a UUID"));
    name.to_string()
}

#[tokio::test]
async fn upload_image_stores_file_under_returned_unique_name() {
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=true", Some("photo.png"), b"PNGDATA");
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["message"], "File uploaded successfully");
    // The key is NOT the client's filename — it's the returned unique name,
    // and it lives under that name's own prefix (#273).
    assert!(!store.contains("images/photo.png"));
    let file_name = uploaded_file_name(&body, ".png");
    let stored = store.get(&original_key(&file_name)).expect("stored");
    assert_eq!(stored.data, b"PNGDATA");
    assert!(stored.public);
}

#[tokio::test]
async fn uploads_with_identical_client_filenames_never_collide() {
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=true", Some("photo.png"), b"FIRST");
    let (_, body_a) = send(app.clone(), req).await;
    let req = multipart_upload("/images?isPublished=true", Some("photo.png"), b"SECOND");
    let (_, body_b) = send(app, req).await;
    let name_a = uploaded_file_name(&body_a, ".png");
    let name_b = uploaded_file_name(&body_b, ".png");
    assert_ne!(name_a, name_b);
    // Both objects exist with their own data — nothing was overwritten.
    assert_eq!(store.get(&original_key(&name_a)).unwrap().data, b"FIRST");
    assert_eq!(store.get(&original_key(&name_b)).unwrap().data, b"SECOND");
}

#[tokio::test]
async fn upload_unpublished_image_is_tagged_private() {
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=false", Some("draft.jpg"), b"JPG");
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::OK);
    let file_name = uploaded_file_name(&body, ".jpg");
    assert!(!store.get(&original_key(&file_name)).unwrap().public);
}

#[tokio::test]
async fn upload_preserves_extension_lowercased() {
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=true", Some("photo.PNG"), b"PNG");
    let (_, body) = send(app, req).await;
    let file_name = uploaded_file_name(&body, ".png");
    assert!(store.contains(&original_key(&file_name)));
}

#[tokio::test]
async fn upload_keeps_only_the_last_extension_of_a_dotted_name() {
    let (_, app) = setup();
    let req = multipart_upload("/images?isPublished=true", Some("archive.tar.gz"), b"GZ");
    let (_, body) = send(app, req).await;
    uploaded_file_name(&body, ".gz");
}

#[tokio::test]
async fn upload_without_filename_gets_uuid_key_with_no_extension() {
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=false", None, b"data");
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::OK);
    let file_name = uploaded_file_name(&body, "");
    assert!(store.contains(&original_key(&file_name)));
}

#[tokio::test]
async fn upload_drops_unusable_extensions() {
    // None of these client names carries a safe extension: no dot, dotfile,
    // trailing dot, non-alphanumeric characters (path traversal, markup),
    // or an overlong suffix. All must produce a bare-UUID key.
    for client_name in [
        "noextension",
        ".png",
        "photo.",
        "../../etc/passwd",
        "photo.<script>",
        "photo.averyveryverylongextension",
    ] {
        let (_, app) = setup();
        let req = multipart_upload("/images?isPublished=true", Some(client_name), b"x");
        let (status, body) = send(app, req).await;
        assert_eq!(status, StatusCode::OK, "client name {client_name:?}");
        uploaded_file_name(&body, "");
    }
}

#[tokio::test]
async fn upload_with_malformed_multipart_body_is_400() {
    // The content type promises multipart but the body never contains the
    // boundary, so reading the first field fails.
    let (_, app) = setup();
    let req = multipart_request(
        "/images?isPublished=true",
        b"this body is not multipart at all".to_vec(),
    );
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"error": "Invalid multipart"}));
}

#[tokio::test]
async fn upload_failing_mid_stream_is_400_and_stores_nothing() {
    // The request body errors after the field header and some data: the
    // handler must fail the upload rather than store a truncated image.
    let (store, app) = setup();
    let prefix = bytes::Bytes::from(format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo.png\"\r\n\r\nPARTIAL-DATA"
    ));
    // First poll: the field headers plus some data. Second poll: Pending, so
    // the multipart parser hands the field to the handler instead of eagerly
    // consuming the error during `next_field`. Third poll: the stream fails,
    // surfacing as a mid-stream `field.chunk()` error.
    let mut polls = 0;
    let stream = futures::stream::poll_fn(move |cx| {
        polls += 1;
        match polls {
            1 => std::task::Poll::Ready(Some(Ok::<_, std::io::Error>(prefix.clone()))),
            2 => {
                cx.waker().wake_by_ref();
                std::task::Poll::Pending
            }
            _ => std::task::Poll::Ready(Some(Err(std::io::Error::new(
                std::io::ErrorKind::ConnectionReset,
                "connection reset mid-upload",
            )))),
        }
    });
    let req = Request::builder()
        .method("POST")
        .uri("/images?isPublished=true")
        .header(header::AUTHORIZATION, bearer())
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from_stream(stream))
        .unwrap();
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"error": "Failed to read uploaded file"}));
    // Nothing may have been stored under images/.
    assert!(store
        .list_objects("images/")
        .await
        .expect("list")
        .is_empty());
}

#[tokio::test]
async fn upload_with_no_file_is_400() {
    let (_, app) = setup();
    let req = multipart_request(
        "/images?isPublished=true",
        format!("--{BOUNDARY}--\r\n").into_bytes(),
    );
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({"error": "No file found"}));
}

#[tokio::test]
async fn upload_image_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let req = multipart_upload("/images?isPublished=true", Some("photo.png"), b"PNGDATA");
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to upload image"}));
}

// --- upload thumbnails ------------------------------------------------------

/// A real encoded PNG of the given size — the thumbnail generator needs
/// bytes it can actually decode.
fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(width, height, |x, _| {
        image::Rgb([(x % 256) as u8, 30, 200])
    }));
    let mut out = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png encodes");
    out
}

#[tokio::test]
async fn upload_image_also_stores_a_thumbnail_next_to_the_original() {
    let (store, app) = setup();
    let req = multipart_upload(
        "/images?isPublished=true",
        Some("photo.png"),
        &png_bytes(1200, 800),
    );
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::OK);
    let file_name = uploaded_file_name(&body, ".png");

    let thumb = store
        .get(&variant_key(&file_name, ImageVariant::Thumb))
        .expect("thumbnail stored");
    // Same visibility as the original: a public image's thumbnail must be
    // readable by the public site, a private one's must not.
    assert!(thumb.public);
    let decoded = image::load_from_memory(&thumb.data).expect("thumbnail decodes");
    assert_eq!((decoded.width(), decoded.height()), (480, 320));
    assert_eq!(
        image::guess_format(&thumb.data).expect("format"),
        image::ImageFormat::Jpeg
    );
}

#[tokio::test]
async fn upload_of_a_private_image_stores_a_private_thumbnail() {
    let (store, app) = setup();
    let req = multipart_upload(
        "/images?isPublished=false",
        Some("photo.png"),
        &png_bytes(200, 200),
    );
    let (_, body) = send(app, req).await;
    let file_name = uploaded_file_name(&body, ".png");
    assert!(
        !store
            .get(&variant_key(&file_name, ImageVariant::Thumb))
            .expect("thumbnail stored")
            .public
    );
}

#[tokio::test]
async fn upload_of_undecodable_bytes_still_succeeds_without_a_thumbnail() {
    // A file the decoder cannot read (or a format we do not support) must
    // not fail the upload — `?size=thumb` falls back to the original.
    let _tracing = common::capture_tracing();
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=true", Some("photo.png"), b"PNGDATA");
    let (status, body) = send(app, req).await;

    assert_eq!(status, StatusCode::OK);
    let file_name = uploaded_file_name(&body, ".png");
    assert_eq!(
        store.get(&original_key(&file_name)).expect("stored").data,
        b"PNGDATA"
    );
    assert!(!store.contains(&variant_key(&file_name, ImageVariant::Thumb)));
}

#[tokio::test]
async fn upload_survives_a_failed_thumbnail_write() {
    // The original is stored by the first put; the thumbnail's put fails.
    // The upload still succeeds and the original is kept.
    let _tracing = common::capture_tracing();
    let (store, app) = setup();
    store.set_failing_puts_after(1);
    let req = multipart_upload(
        "/images?isPublished=true",
        Some("photo.png"),
        &png_bytes(600, 400),
    );
    let (status, body) = send(app, req).await;

    assert_eq!(status, StatusCode::OK);
    let file_name = uploaded_file_name(&body, ".png");
    assert!(store.contains(&original_key(&file_name)));
    assert!(!store.contains(&variant_key(&file_name, ImageVariant::Thumb)));
}

#[tokio::test]
async fn set_image_published_updates_every_object_under_the_prefix() {
    // A public reference to any variant needs THAT object tagged, so the
    // whole directory flips together (#273).
    let (store, app) = setup_with(
        InMemoryStore::default()
            .with_object("images/photo.png/original.png", "PNG")
            .with_object("images/photo.png/thumb.jpg", "JPG"),
    );
    let (status, body) = send(
        app,
        put_auth("/images/photo.png/set-published?isPublished=false"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Image published status updated"}));
    assert!(!store.get("images/photo.png/original.png").unwrap().public);
    assert!(!store.get("images/photo.png/thumb.jpg").unwrap().public);
}

#[tokio::test]
async fn set_image_published_updates_a_legacy_single_object() {
    let (store, app) = setup_with(InMemoryStore::default().with_object("images/photo.png", "PNG"));
    let (status, body) = send(
        app,
        put_auth("/images/photo.png/set-published?isPublished=false"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Image published status updated"}));
    assert!(!store.get("images/photo.png").expect("stored").public);
}

#[tokio::test]
async fn set_image_published_updates_both_layouts_when_both_exist() {
    // Mid-migration: the copy exists and the legacy object has not been
    // cleaned up yet. Neither may be left behind with the wrong visibility.
    let (store, app) = setup_with(
        InMemoryStore::default()
            .with_object("images/photo.png", "PNG")
            .with_object("images/photo.png/original.png", "PNG")
            .with_object("images/photo.png/thumb.jpg", "JPG"),
    );
    let (status, _) = send(
        app,
        put_auth("/images/photo.png/set-published?isPublished=false"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    for key in [
        "images/photo.png",
        "images/photo.png/original.png",
        "images/photo.png/thumb.jpg",
    ] {
        assert!(!store.get(key).unwrap().public, "{key} should be private");
    }
}

#[tokio::test]
async fn set_image_published_missing_is_404() {
    let (_, app) = setup();
    let (status, body) = send(
        app,
        put_auth("/images/missing.png/set-published?isPublished=true"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({"error": "Image not found"}));
}

#[tokio::test]
async fn set_image_published_store_outage_is_500() {
    let (store, app) =
        setup_with(InMemoryStore::default().with_object("images/photo.png/original.png", "PNG"));
    store.set_failing(true);
    let (status, body) = send(
        app,
        put_auth("/images/photo.png/set-published?isPublished=true"),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body,
        json!({"error": "Failed to update image published status"})
    );
}

// There is deliberately no DELETE /images/:filename endpoint: per-image
// deletion cannot know what still references an image (the same object can
// back a haiga, a post, AND the site background), so the reference-checked
// GC sweep (POST /images/gc) is the only way image objects are removed.

// --------------------------------------------------------------- version

#[tokio::test]
async fn version_is_public_and_reports_the_build_sha_or_null() {
    // The test binary is built without KARI_COMMIT_SHA, so the sha is
    // null; deployed binaries carry the commit the workflow baked in. Either
    // way the shape is fixed -- the admin page keys off `sha` being a
    // string.
    let (_store, app) = setup();
    let expected = kari_website_api::routes::version::COMMIT_SHA
        .map(Value::from)
        .unwrap_or(Value::Null);
    assert_eq!(
        send(app, get("/version")).await,
        (StatusCode::OK, json!({ "sha": expected }))
    );
}

// ---------------------------------------------------------------- health

#[tokio::test]
async fn health_is_ok_and_write_probe_leaves_private_marker() {
    let (store, app) = setup();
    assert_eq!(
        send(app, get("/health")).await,
        (StatusCode::OK, json!({"status": "ok"}))
    );
    // The write probe stored its marker, tagged NOT public.
    assert!(!store.get("_health").expect("probe marker").public);
}

#[tokio::test]
async fn health_is_unhealthy_when_store_is_down() {
    let (store, app) = setup();
    store.set_failing(true);
    assert_eq!(
        send(app, get("/health")).await,
        (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"status": "unhealthy"})
        )
    );
}

#[tokio::test]
async fn health_catches_write_only_breakage() {
    // Reads working but writes broken is exactly the July 2026 failure the
    // write probe exists for; a read-only probe would report healthy here.
    let (store, app) = setup();
    store.set_failing_puts(true);
    assert_eq!(
        send(app, get("/health")).await,
        (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"status": "unhealthy"})
        )
    );
}

#[tokio::test]
async fn health_result_is_cached_between_requests() {
    let (store, app) = setup();
    let (status, _) = send(app.clone(), get("/health")).await;
    assert_eq!(status, StatusCode::OK);
    // The store breaking right after a healthy probe is not noticed until the
    // cached result expires (60s TTL), so this still reports ok.
    store.set_failing(true);
    let (status, _) = send(app, get("/health")).await;
    assert_eq!(status, StatusCode::OK);
}
