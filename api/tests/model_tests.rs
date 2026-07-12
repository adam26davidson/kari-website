//! Serde (de)serialization tests for the REAL model types in `models`.
//!
//! These guard the wire contract shared with the TypeScript frontend — in
//! particular the `isPublished` camelCase rename, which a serde upgrade could
//! silently break.

use kari_website_api::models::{BlogPost, BlogPostUpdate, Haiga, Haiku, IsPublishedQuery};

#[test]
fn haiku_round_trips() {
    let haiku = Haiku {
        id: "abc".into(),
        lines: vec!["one".into(), "two".into(), "three".into()],
        publisher: "kari".into(),
    };
    let json = serde_json::to_string(&haiku).unwrap();
    let back: Haiku = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, haiku.id);
    assert_eq!(back.lines, haiku.lines);
    assert_eq!(back.publisher, haiku.publisher);
}

#[test]
fn haiga_includes_image_field() {
    let json = r#"{"id":"1","lines":["a"],"publisher":"kari","image":"pic.jpg"}"#;
    let haiga: Haiga = serde_json::from_str(json).unwrap();
    assert_eq!(haiga.image, "pic.jpg");
}

#[test]
fn blog_post_serializes_is_published_as_camel_case() {
    let post = BlogPost {
        id: "1".into(),
        title: "Title".into(),
        date: "2025-01-01".into(),
        is_published: true,
    };
    let json = serde_json::to_string(&post).unwrap();
    assert!(
        json.contains("\"isPublished\":true"),
        "expected camelCase isPublished, got: {json}"
    );
    assert!(!json.contains("is_published"), "snake_case leaked: {json}");
}

#[test]
fn blog_post_deserializes_camel_case_is_published() {
    let json = r#"{"id":"1","title":"t","date":"d","isPublished":false}"#;
    let post: BlogPost = serde_json::from_str(json).unwrap();
    assert!(!post.is_published);
}

#[test]
fn blog_post_update_uses_camel_case_is_published() {
    let json = r#"{"id":"1","content":"hello","isPublished":true}"#;
    let update: BlogPostUpdate = serde_json::from_str(json).unwrap();
    assert!(update.is_published);
    assert_eq!(update.content, "hello");
}

#[test]
fn is_published_query_parses_camel_case() {
    let query: IsPublishedQuery = serde_json::from_str(r#"{"isPublished":true}"#).unwrap();
    assert!(query.is_published);
}
