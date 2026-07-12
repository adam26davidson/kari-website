//! Tests for the REAL `S3Error` type and its formatting in `services/s3.rs`,
//! plus an opt-in end-to-end test against a live bucket.
//!
//! The `From<SdkError>` conversion (404 -> NotFound) is covered by the live
//! integration test below; a fully mocked SDK client would require the
//! `aws-smithy-mocks` crate and is a good future addition (see tests/README.md).

use aws_sdk_s3::Client;
use kari_website_api::services::s3::{S3Error, S3Service};

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

/// Opt-in end-to-end test. Requires real AWS credentials and a writable test
/// bucket; run with `cargo test --ignored` and `TEST_S3_BUCKET` set.
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
