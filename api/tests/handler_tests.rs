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

// ---------------------------------------------------------------- blog

fn sample_blog_posts() -> Value {
    json!([{"id": "b1", "title": "Hello", "date": "2026-08-04", "isPublished": true}])
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
    let (_, app) = setup_with(InMemoryStore::default().with_object("blog-posts.json", "oops"));
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

#[tokio::test]
async fn get_image_serves_bytes_with_guessed_content_type() {
    let png = vec![0x89u8, b'P', b'N', b'G'];
    let (_, app) =
        setup_with(InMemoryStore::default().with_object("images/photo.png", png.clone()));
    let response = app.oneshot(get("/images/photo.png")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .expect("content-type set"),
        "image/png"
    );
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), png.as_slice());
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

#[tokio::test]
async fn upload_image_stores_file_with_publish_flag() {
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=true", Some("photo.png"), b"PNGDATA");
    let (status, body) = send(app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "File uploaded successfully"}));
    let stored = store.get("images/photo.png").expect("stored");
    assert_eq!(stored.data, b"PNGDATA");
    assert!(stored.public);
}

#[tokio::test]
async fn upload_unpublished_image_is_tagged_private() {
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=false", Some("draft.jpg"), b"JPG");
    let (status, _) = send(app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!store.get("images/draft.jpg").expect("stored").public);
}

#[tokio::test]
async fn upload_without_filename_uses_default_key() {
    let (store, app) = setup();
    let req = multipart_upload("/images?isPublished=false", None, b"data");
    let (status, _) = send(app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert!(store.contains("images/upload_file"));
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

#[tokio::test]
async fn set_image_published_updates_tag() {
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
    let (store, app) = setup_with(InMemoryStore::default().with_object("images/photo.png", "PNG"));
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

#[tokio::test]
async fn delete_image_removes_object() {
    let (store, app) = setup_with(InMemoryStore::default().with_object("images/photo.png", "PNG"));
    let (status, body) = send(app, delete_auth("/images/photo.png")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Image deleted successfully"}));
    assert!(!store.contains("images/photo.png"));
}

#[tokio::test]
async fn delete_image_is_idempotent_for_missing_object() {
    // S3 deletes never report NotFound, so a missing image still deletes OK.
    let (_store, app) = setup();
    let (status, body) = send(app, delete_auth("/images/never-existed.png")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"message": "Image deleted successfully"}));
}

#[tokio::test]
async fn delete_image_store_outage_is_500() {
    let (store, app) = setup();
    store.set_failing(true);
    let (status, body) = send(app, delete_auth("/images/photo.png")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({"error": "Failed to delete image"}));
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
