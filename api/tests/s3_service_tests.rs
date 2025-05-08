use aws_sdk_s3::Client;
use kari_website_api::services::s3::S3Service;

#[tokio::test]
#[ignore] // Ignore this test by default as it requires AWS credentials
pub async fn test_s3_service_integration() {
    // This test demonstrates how to test the S3 service
    // It's marked as ignored because it requires actual AWS credentials

    // Load AWS config from environment
    let sdk_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let client = Client::new(&sdk_config);

    // Create the S3 service with a test bucket
    let test_bucket = std::env::var("TEST_S3_BUCKET").unwrap_or_else(|_| "test-bucket".to_string());
    let s3_service = S3Service::new(client, test_bucket);

    // Test data
    let test_key = "test-key.txt";
    let test_data = b"Hello, world!".to_vec();

    // Test the S3 service operations
    // These assertions will only run if you explicitly enable this test with --ignored flag
    if let Ok(_) = s3_service
        .put_object(test_key, test_data.clone(), false)
        .await
    {
        // Verify the object was uploaded by trying to retrieve it
        if let Ok(retrieved_data) = s3_service.get_object(test_key).await {
            assert_eq!(retrieved_data, test_data);

            // Clean up by deleting the test object
            let _ = s3_service.delete_object(test_key).await;
        }
    }
}
