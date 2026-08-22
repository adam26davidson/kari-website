//! Tests for the REAL `S3Service` and `S3Error` in `services/s3.rs`.
//!
//! The SDK calls (`get_object`, `put_object`, `set_object_tagging`,
//! `delete_object`) and the `From<SdkError>` conversion are exercised against
//! a mocked S3 client built with `aws-smithy-mocks` — no network, no
//! credentials. An `#[ignore]`d end-to-end test against a live bucket remains
//! as the opt-in real-AWS check.

use aws_sdk_s3::operation::copy_object::CopyObjectOutput;
use aws_sdk_s3::operation::delete_object::DeleteObjectOutput;
use aws_sdk_s3::operation::get_object::GetObjectOutput;
use aws_sdk_s3::operation::get_object_tagging::GetObjectTaggingOutput;
use aws_sdk_s3::operation::list_objects_v2::ListObjectsV2Output;
use aws_sdk_s3::operation::put_object::PutObjectOutput;
use aws_sdk_s3::operation::put_object_tagging::PutObjectTaggingOutput;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{MetadataDirective, Object, Tag};
use aws_sdk_s3::Client;
use aws_smithy_mocks::{mock, mock_client, RuleMode};
use aws_smithy_runtime_api::box_error::BoxError;
use aws_smithy_runtime_api::client::interceptors::context::BeforeTransmitInterceptorContextRef;
use aws_smithy_runtime_api::client::interceptors::Intercept;
use aws_smithy_runtime_api::client::orchestrator::HttpResponse;
use aws_smithy_runtime_api::client::runtime_components::RuntimeComponents;
use aws_smithy_runtime_api::http::StatusCode;
use aws_smithy_types::body::SdkBody;
use aws_smithy_types::config_bag::ConfigBag;
use aws_smithy_types::DateTime;
use kari_website_api::services::object_store::ObjectStore;
use kari_website_api::services::s3::{S3Error, S3Service};
use std::sync::{Arc, Mutex};

const BUCKET: &str = "test-bucket";

/// An S3-style XML error response with the given status and error code, as
/// the real service would return it.
fn s3_error_response(status: u16, code: &str, message: &str) -> HttpResponse {
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <Error><Code>{code}</Code><Message>{message}</Message></Error>"
    );
    HttpResponse::new(
        StatusCode::try_from(status).expect("valid status code"),
        SdkBody::from(body),
    )
}

// --- S3Error type -----------------------------------------------------------

#[test]
fn not_found_displays_clearly() {
    assert_eq!(S3Error::NotFound.to_string(), "Resource not found");
}

#[test]
fn operation_failed_includes_underlying_message() {
    let err = S3Error::OperationFailed("connection reset".to_string());
    let rendered = err.to_string();
    assert!(rendered.contains("connection reset"), "got: {rendered}");
    assert!(rendered.contains("S3 operation failed"), "got: {rendered}");
}

#[test]
fn s3_error_implements_std_error() {
    // Compile-time-ish guarantee that S3Error can be boxed as a std::error::Error.
    fn assert_error<E: std::error::Error>(_: &E) {}
    assert_error(&S3Error::NotFound);
}

// --- get_object -------------------------------------------------------------

#[tokio::test]
async fn get_object_returns_body_bytes() {
    let rule = mock!(Client::get_object)
        .match_requests(|req| req.bucket() == Some(BUCKET) && req.key() == Some("photos/cat.jpg"))
        .then_output(|| {
            GetObjectOutput::builder()
                .body(ByteStream::from_static(b"jpeg bytes"))
                .build()
        });
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let data = service
        .get_object("photos/cat.jpg")
        .await
        .expect("get should succeed");

    assert_eq!(data, b"jpeg bytes");
    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn get_object_maps_404_to_not_found() {
    let rule = mock!(Client::get_object)
        .then_http_response(|| s3_error_response(404, "NoSuchKey", "The key does not exist."));
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let err = service
        .get_object("missing-key")
        .await
        .expect_err("404 should be an error");

    assert!(matches!(err, S3Error::NotFound), "got: {err:?}");
}

#[tokio::test]
async fn get_object_maps_other_service_errors_to_operation_failed_with_cause() {
    let rule = mock!(Client::get_object)
        .then_http_response(|| s3_error_response(403, "AccessDenied", "Access Denied"));
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let err = service
        .get_object("forbidden-key")
        .await
        .expect_err("403 should be an error");

    // The From<SdkError> impl Debug-formats the error precisely so that the
    // underlying cause (e.g. AccessDenied) survives into logs; a bare Display
    // would collapse it to "service error". Assert the detail is preserved.
    match err {
        S3Error::OperationFailed(detail) => {
            assert!(detail.contains("AccessDenied"), "got: {detail}");
        }
        other => panic!("expected OperationFailed, got: {other:?}"),
    }
}

// --- put_object -------------------------------------------------------------

#[tokio::test]
async fn put_object_sends_body_and_public_tag() {
    let rule = mock!(Client::put_object)
        .match_requests(|req| {
            req.bucket() == Some(BUCKET)
                && req.key() == Some("photos/dog.jpg")
                && req.tagging() == Some("public=true")
        })
        .then_output(|| PutObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .put_object("photos/dog.jpg", b"dog bytes".to_vec(), true)
        .await
        .expect("put should succeed");

    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn put_object_tags_private_uploads_as_not_public() {
    let rule = mock!(Client::put_object)
        .match_requests(|req| req.tagging() == Some("public=false"))
        .then_output(|| PutObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .put_object("drafts/wip.jpg", b"draft bytes".to_vec(), false)
        .await
        .expect("put should succeed");

    assert_eq!(rule.num_calls(), 1);
}

// Published documents are rewritten in place under stable keys, and S3's
// `Last-Modified` only has one-second granularity — without `Cache-Control:
// no-cache` a same-second rewrite leaves browsers serving stale content on
// `If-Modified-Since` revalidation forever (#90). Documents must carry the
// header; images must NOT, so their long-lived caching stays unchanged.

#[tokio::test]
async fn put_object_sets_no_cache_on_json_documents() {
    let rule = mock!(Client::put_object)
        .match_requests(|req| {
            req.key() == Some("haiga.json") && req.cache_control() == Some("no-cache")
        })
        .then_output(|| PutObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .put_object("haiga.json", b"[]".to_vec(), true)
        .await
        .expect("put should succeed");

    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn put_object_sets_no_cache_on_blog_html_content() {
    let rule = mock!(Client::put_object)
        .match_requests(|req| {
            req.key() == Some("blog/post-1.html") && req.cache_control() == Some("no-cache")
        })
        .then_output(|| PutObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .put_object("blog/post-1.html", b"<p>hi</p>".to_vec(), true)
        .await
        .expect("put should succeed");

    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn put_object_leaves_cache_control_unset_on_images() {
    let rule = mock!(Client::put_object)
        .match_requests(|req| req.key() == Some("images/dog.jpg") && req.cache_control().is_none())
        .then_output(|| PutObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .put_object("images/dog.jpg", b"jpeg bytes".to_vec(), true)
        .await
        .expect("put should succeed");

    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn put_object_maps_service_error_to_operation_failed() {
    let rule = mock!(Client::put_object)
        .then_http_response(|| s3_error_response(403, "AccessDenied", "Access Denied"));
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let err = service
        .put_object("k", b"data".to_vec(), false)
        .await
        .expect_err("403 should be an error");

    match err {
        S3Error::OperationFailed(detail) => {
            assert!(detail.contains("AccessDenied"), "got: {detail}");
        }
        other => panic!("expected OperationFailed, got: {other:?}"),
    }
}

// --- set_object_tagging -----------------------------------------------------

#[tokio::test]
async fn set_object_tagging_sends_public_tag() {
    let rule = mock!(Client::put_object_tagging)
        .match_requests(|req| {
            let tag_is_public_true = req.tagging().is_some_and(|tagging| {
                tagging
                    .tag_set()
                    .iter()
                    .any(|tag| tag.key() == "public" && tag.value() == "true")
            });
            req.bucket() == Some(BUCKET)
                && req.key() == Some("photos/cat.jpg")
                && tag_is_public_true
        })
        .then_output(|| PutObjectTaggingOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .set_object_tagging("photos/cat.jpg", true)
        .await
        .expect("tagging should succeed");

    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn set_object_tagging_maps_404_to_not_found() {
    let rule = mock!(Client::put_object_tagging)
        .then_http_response(|| s3_error_response(404, "NoSuchKey", "The key does not exist."));
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let err = service
        .set_object_tagging("missing-key", false)
        .await
        .expect_err("404 should be an error");

    assert!(matches!(err, S3Error::NotFound), "got: {err:?}");
}

// --- delete_object ----------------------------------------------------------

#[tokio::test]
async fn delete_object_deletes_by_key() {
    let rule = mock!(Client::delete_object)
        .match_requests(|req| req.bucket() == Some(BUCKET) && req.key() == Some("photos/old.jpg"))
        .then_output(|| DeleteObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .delete_object("photos/old.jpg")
        .await
        .expect("delete should succeed");

    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn delete_object_maps_service_error_to_operation_failed() {
    let rule = mock!(Client::delete_object)
        .then_http_response(|| s3_error_response(403, "AccessDenied", "Access Denied"));
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let err = service
        .delete_object("k")
        .await
        .expect_err("403 should be an error");

    match err {
        S3Error::OperationFailed(detail) => {
            assert!(detail.contains("AccessDenied"), "got: {detail}");
        }
        other => panic!("expected OperationFailed, got: {other:?}"),
    }
}

// --- list_objects -----------------------------------------------------------

#[tokio::test]
async fn list_objects_returns_keys_and_last_modified() {
    let rule = mock!(Client::list_objects_v2)
        .match_requests(|req| req.bucket() == Some(BUCKET) && req.prefix() == Some("images/"))
        .then_output(|| {
            ListObjectsV2Output::builder()
                .contents(
                    Object::builder()
                        .key("images/a.jpg")
                        .last_modified(DateTime::from_secs(1_700_000_000))
                        .build(),
                )
                .contents(Object::builder().key("images/b.png").build())
                .build()
        });
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let objects = service
        .list_objects("images/")
        .await
        .expect("list should succeed");

    assert_eq!(rule.num_calls(), 1);
    let keys: Vec<&str> = objects.iter().map(|o| o.key.as_str()).collect();
    assert_eq!(keys, vec!["images/a.jpg", "images/b.png"]);
    assert!(
        objects[0].last_modified.is_some(),
        "reported timestamp should survive the conversion"
    );
    assert!(
        objects[1].last_modified.is_none(),
        "missing timestamp should surface as None, not a fake value"
    );
}

#[tokio::test]
async fn list_objects_follows_pagination_to_the_end() {
    // A truncated listing that stopped after one page would make every
    // object on later pages look orphaned to the GC sweep, so the paginated
    // path is the one that matters.
    let first_page = mock!(Client::list_objects_v2)
        .match_requests(|req| req.continuation_token().is_none())
        .then_output(|| {
            ListObjectsV2Output::builder()
                .contents(Object::builder().key("images/page1.jpg").build())
                .is_truncated(true)
                .next_continuation_token("page-2")
                .build()
        });
    let second_page = mock!(Client::list_objects_v2)
        .match_requests(|req| req.continuation_token() == Some("page-2"))
        .then_output(|| {
            ListObjectsV2Output::builder()
                .contents(Object::builder().key("images/page2.jpg").build())
                .build()
        });
    let client = mock_client!(
        aws_sdk_s3,
        RuleMode::Sequential,
        [&first_page, &second_page]
    );
    let service = S3Service::new(client, BUCKET.to_string());

    let objects = service
        .list_objects("images/")
        .await
        .expect("list should succeed");

    assert_eq!(first_page.num_calls(), 1);
    assert_eq!(second_page.num_calls(), 1);
    let keys: Vec<&str> = objects.iter().map(|o| o.key.as_str()).collect();
    assert_eq!(keys, vec!["images/page1.jpg", "images/page2.jpg"]);
}

#[tokio::test]
async fn list_objects_maps_service_error_to_operation_failed() {
    let rule = mock!(Client::list_objects_v2)
        .then_http_response(|| s3_error_response(403, "AccessDenied", "Access Denied"));
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let err = service
        .list_objects("images/")
        .await
        .expect_err("403 should be an error");

    match err {
        S3Error::OperationFailed(detail) => {
            assert!(detail.contains("AccessDenied"), "got: {detail}");
        }
        other => panic!("expected OperationFailed, got: {other:?}"),
    }
}

// --- content type ------------------------------------------------------------

// Objects the public site fetches straight from S3 must carry a real
// `Content-Type`, so `images/<id>/original.png` renders as an image rather
// than as `binary/octet-stream` (#273).

#[tokio::test]
async fn put_object_sets_content_type_from_the_key() {
    let rule = mock!(Client::put_object)
        .match_requests(|req| {
            req.key() == Some("images/x.jpg/original.jpg")
                && req.content_type() == Some("image/jpeg")
        })
        .then_output(|| PutObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .put_object("images/x.jpg/original.jpg", b"jpeg".to_vec(), true)
        .await
        .expect("put should succeed");

    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn put_object_sets_content_type_on_json_documents() {
    let rule = mock!(Client::put_object)
        .match_requests(|req| req.content_type() == Some("application/json"))
        .then_output(|| PutObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .put_object("haiku.json", b"[]".to_vec(), true)
        .await
        .expect("put should succeed");

    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn put_object_leaves_content_type_unset_for_an_unguessable_key() {
    let rule = mock!(Client::put_object)
        .match_requests(|req| req.key() == Some("_health") && req.content_type().is_none())
        .then_output(|| PutObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .put_object("_health", b"ok".to_vec(), false)
        .await
        .expect("put should succeed");

    assert_eq!(rule.num_calls(), 1);
}

// --- copy_object -------------------------------------------------------------

#[tokio::test]
async fn copy_object_copies_within_the_bucket_and_keeps_tags() {
    let rule = mock!(Client::copy_object)
        .match_requests(|req| {
            req.bucket() == Some(BUCKET)
                && req.key() == Some("images/x.jpg/original.jpg")
                && req.copy_source() == Some("test-bucket/images/x.jpg")
                // The copy replaces metadata so it can gain a real content
                // type, but the `public=` tag must still be copied — the
                // default TaggingDirective (COPY) is what keeps migrated
                // originals as public as their sources.
                && req.metadata_directive() == Some(&MetadataDirective::Replace)
                && req.content_type() == Some("image/jpeg")
                && req.tagging_directive().is_none()
        })
        .then_output(|| CopyObjectOutput::builder().build());
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    service
        .copy_object("images/x.jpg", "images/x.jpg/original.jpg")
        .await
        .expect("copy should succeed");

    assert_eq!(rule.num_calls(), 1);
}

/// Captures the serialized `x-amz-copy-source` header, so a test can assert on
/// what actually goes on the wire rather than on the input the SDK was handed.
#[derive(Debug, Clone, Default)]
struct CaptureCopySource(Arc<Mutex<Option<String>>>);

impl CaptureCopySource {
    fn captured(&self) -> Option<String> {
        self.0.lock().expect("not poisoned").clone()
    }
}

impl Intercept for CaptureCopySource {
    fn name(&self) -> &'static str {
        "CaptureCopySource"
    }

    fn read_before_transmit(
        &self,
        context: &BeforeTransmitInterceptorContextRef<'_>,
        _components: &RuntimeComponents,
        _cfg: &mut ConfigBag,
    ) -> Result<(), BoxError> {
        *self.0.lock().expect("not poisoned") = context
            .request()
            .headers()
            .get("x-amz-copy-source")
            .map(str::to_string);
        Ok(())
    }
}

#[tokio::test]
async fn copy_object_percent_encodes_the_source_key() {
    // `x-amz-copy-source` is a header whose value S3 requires URL-encoded, and
    // the SDK does not encode it for us. Legacy `images/<name>` keys are raw
    // client filenames, so they can hold spaces, `%`, `+` and non-ASCII. Left
    // raw, `%`/`+` are decoded by S3 into a *different* key (NoSuchKey) and
    // non-ASCII goes out as raw obs-text bytes S3 will not accept — and one
    // such object is enough to abort the whole `migrate_images` run.
    let key = "images/café 100%+more.jpg";
    let rule = mock!(Client::copy_object)
        .match_requests(move |req| req.key() == Some("images/café 100%+more.jpg/original.jpg"))
        .then_output(|| CopyObjectOutput::builder().build());
    let capture = CaptureCopySource::default();
    let client = mock_client!(aws_sdk_s3, RuleMode::Sequential, [&rule], |conf| conf
        .interceptor(capture.clone()));
    let service = S3Service::new(client, BUCKET.to_string());

    service
        .copy_object(key, &format!("{key}/original.jpg"))
        .await
        .expect("copy should succeed");

    // Separators stay literal: the value is `<bucket>/<key>`, and the key's
    // own slashes are path separators to S3 too.
    assert_eq!(
        capture.captured().as_deref(),
        Some("test-bucket/images/caf%C3%A9%20100%25%2Bmore.jpg")
    );
    assert_eq!(rule.num_calls(), 1);
}

#[tokio::test]
async fn copy_object_maps_404_to_not_found() {
    let rule = mock!(Client::copy_object)
        .then_http_response(|| s3_error_response(404, "NoSuchKey", "The key does not exist."));
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let err = service
        .copy_object("images/missing", "images/missing/original")
        .await
        .expect_err("404 should be an error");

    assert!(matches!(err, S3Error::NotFound), "got: {err:?}");
}

// --- get_object_public -------------------------------------------------------

#[tokio::test]
async fn get_object_public_reads_the_public_tag() {
    let rule = mock!(Client::get_object_tagging)
        .match_requests(|req| req.bucket() == Some(BUCKET) && req.key() == Some("images/x.jpg"))
        .then_output(|| {
            GetObjectTaggingOutput::builder()
                .tag_set(Tag::builder().key("public").value("true").build().unwrap())
                .build()
                .unwrap()
        });
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    assert!(service
        .get_object_public("images/x.jpg")
        .await
        .expect("tagging should be readable"));
}

#[tokio::test]
async fn get_object_public_is_false_for_a_private_or_untagged_object() {
    for tags in [Some(("public", "false")), Some(("other", "true")), None] {
        let rule = mock!(Client::get_object_tagging).then_output(move || {
            let mut builder = GetObjectTaggingOutput::builder().set_tag_set(Some(Vec::new()));
            if let Some((key, value)) = tags {
                builder = builder.tag_set(Tag::builder().key(key).value(value).build().unwrap());
            }
            builder.build().unwrap()
        });
        let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

        assert!(
            !service
                .get_object_public("images/x.jpg")
                .await
                .expect("tagging should be readable"),
            "tags {tags:?} should not read as public"
        );
    }
}

#[tokio::test]
async fn get_object_public_maps_404_to_not_found() {
    let rule = mock!(Client::get_object_tagging)
        .then_http_response(|| s3_error_response(404, "NoSuchKey", "The key does not exist."));
    let service = S3Service::new(mock_client!(aws_sdk_s3, [&rule]), BUCKET.to_string());

    let err = service
        .get_object_public("missing-key")
        .await
        .expect_err("404 should be an error");

    assert!(matches!(err, S3Error::NotFound), "got: {err:?}");
}

// --- live end-to-end (opt-in) -----------------------------------------------

/// Opt-in end-to-end test. Requires real AWS credentials and a writable test
/// bucket; run with `cargo test -- --ignored` and `TEST_S3_BUCKET` set.
#[tokio::test]
#[ignore]
async fn s3_service_round_trips_against_live_bucket() {
    let sdk_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let client = Client::new(&sdk_config);
    let test_bucket = std::env::var("TEST_S3_BUCKET").unwrap_or_else(|_| "test-bucket".to_string());
    let s3_service = S3Service::new(client, test_bucket);

    let test_key = "test-key.txt";
    let test_data = b"Hello, world!".to_vec();

    s3_service
        .put_object(test_key, test_data.clone(), false)
        .await
        .expect("put should succeed");
    let retrieved = s3_service
        .get_object(test_key)
        .await
        .expect("get should succeed");
    assert_eq!(retrieved, test_data);
    s3_service
        .delete_object(test_key)
        .await
        .expect("delete should succeed");
}
