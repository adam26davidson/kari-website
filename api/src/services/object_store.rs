//! Storage abstraction the handlers and health probe depend on.
//!
//! Everything downstream of `AppState` talks to `dyn ObjectStore` instead of
//! the concrete S3 client, so integration tests can substitute an in-memory
//! implementation. `S3Service` is the only production implementation.

use async_trait::async_trait;

use crate::services::s3::S3Error;

#[async_trait]
pub trait ObjectStore: Send + Sync {
    async fn get_object(&self, key: &str) -> Result<Vec<u8>, S3Error>;

    /// Store an object. `public` becomes the `public=` tag that controls
    /// whether the bucket policy exposes the object for anonymous reads.
    async fn put_object(&self, key: &str, data: Vec<u8>, public: bool) -> Result<(), S3Error>;

    /// Replace the `public=` tag on an existing object; `NotFound` if the
    /// object does not exist.
    async fn set_object_tagging(&self, key: &str, public: bool) -> Result<(), S3Error>;

    /// Delete an object. Like S3, deleting a missing key is not an error.
    async fn delete_object(&self, key: &str) -> Result<(), S3Error>;
}
