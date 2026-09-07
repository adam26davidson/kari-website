//! Serde (de)serialization tests for the REAL model types in `models`.
//!
//! These guard the wire contract shared with the TypeScript frontend — in
//! particular the `isPublished` camelCase rename, which a serde upgrade could
//! silently break.

use kari_website_api::models::{
    normalize_post_date, BlogPost, BlogPostUpdate, Haiga, Haiku, IsPublishedQuery,
};

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

// ------------------------------------------------- normalize_post_date (#523)

/// Shorthand: the canonical form of `day`, which every accepted input maps to.
fn midnight(day: &str) -> Option<String> {
    Some(format!("{day}T00:00:00.000Z"))
}

#[test]
fn normalize_post_date_leaves_a_canonical_date_untouched() {
    assert_eq!(
        normalize_post_date("2026-08-04T00:00:00.000Z"),
        midnight("2026-08-04")
    );
}

#[test]
fn normalize_post_date_pins_a_bare_calendar_day() {
    assert_eq!(normalize_post_date("2026-08-04"), midnight("2026-08-04"));
}

#[test]
fn normalize_post_date_pins_a_non_midnight_instant_to_its_day() {
    assert_eq!(
        normalize_post_date("2026-08-04T13:45:12.345Z"),
        midnight("2026-08-04")
    );
}

#[test]
fn normalize_post_date_keeps_the_day_named_in_the_strings_own_offset() {
    // The #365 hazard: 17:00 on Jan 1 in PST is Jan 2 in UTC, but the author
    // picked Jan 1, so the leading day wins over the instant it denotes.
    assert_eq!(
        normalize_post_date("2026-01-01T17:00:00-08:00"),
        midnight("2026-01-01")
    );
}

#[test]
fn normalize_post_date_accepts_a_leap_day_in_a_leap_year() {
    assert_eq!(normalize_post_date("2024-02-29"), midnight("2024-02-29"));
    // Divisible by 400, so a leap year despite the century rule.
    assert_eq!(normalize_post_date("2000-02-29"), midnight("2000-02-29"));
}

#[test]
fn normalize_post_date_rejects_a_leap_day_in_a_common_year() {
    assert_eq!(normalize_post_date("2023-02-29"), None);
    // Divisible by 100 but not 400, so NOT a leap year.
    assert_eq!(normalize_post_date("1900-02-29"), None);
}

#[test]
fn normalize_post_date_rejects_out_of_range_months_and_days() {
    assert_eq!(normalize_post_date("2026-00-04"), None);
    assert_eq!(normalize_post_date("2026-13-04"), None);
    assert_eq!(normalize_post_date("2026-08-00"), None);
    assert_eq!(normalize_post_date("2026-08-32"), None);
    // Well-shaped but impossible: April has 30 days, February 28 in 2026.
    assert_eq!(normalize_post_date("2026-04-31"), None);
    assert_eq!(normalize_post_date("2026-02-30"), None);
}

#[test]
fn normalize_post_date_accepts_the_last_day_of_every_month_length() {
    assert_eq!(normalize_post_date("2026-01-31"), midnight("2026-01-31"));
    assert_eq!(normalize_post_date("2026-04-30"), midnight("2026-04-30"));
    assert_eq!(normalize_post_date("2026-02-28"), midnight("2026-02-28"));
    assert_eq!(normalize_post_date("2026-12-31"), midnight("2026-12-31"));
}

#[test]
fn normalize_post_date_rejects_malformed_input() {
    assert_eq!(normalize_post_date(""), None);
    assert_eq!(normalize_post_date("not a date"), None);
    assert_eq!(normalize_post_date("20260101"), None);
    assert_eq!(normalize_post_date("2026-1-1"), None);
    assert_eq!(normalize_post_date("2026-08"), None);
    // A day followed by something that is not a time separator: the rest of
    // the string is not an ISO timestamp, so its leading day is not trusted.
    assert_eq!(normalize_post_date("2026-08-04junk"), None);
    assert_eq!(normalize_post_date("2026-08-04 12:00"), None);
}

#[test]
fn normalize_post_date_rejects_multibyte_input_without_panicking() {
    // Byte-level inspection must not slice through a UTF-8 character.
    assert_eq!(normalize_post_date("2026-08-0é"), None);
    assert_eq!(normalize_post_date("日本語"), None);
}
