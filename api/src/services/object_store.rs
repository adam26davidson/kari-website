//! Storage abstraction the handlers and health probe depend on.
//!
//! Everything downstream of `AppState` talks to `dyn ObjectStore` instead of
//! the concrete S3 client, so integration tests can substitute an in-memory
//! implementation. `S3Service` is the only production implementation.

use async_trait::async_trait;
use std::time::SystemTime;

use crate::services::s3::S3Error;

/// Metadata for one listed object, as returned by [`ObjectStore::list_objects`].
#[derive(Clone, Debug)]
pub struct ObjectMeta {
    pub key: String,
    /// When the object was last written. `None` when the backend did not
    /// report a timestamp — consumers that use this for safety decisions
    /// (e.g. the image GC's in-flight-upload margin) must treat `None`
    /// conservatively.
    pub last_modified: Option<SystemTime>,
}

#[async_trait]
pub trait ObjectStore: Send + Sync {
    async fn get_object(&self, key: &str) -> Result<Vec<u8>, S3Error>;

    /// Store an object. `public` becomes the `public=` tag that controls
    /// whether the bucket policy exposes the object for anonymous reads.
    ///
    /// `S3Service` additionally stores `Cache-Control: no-cache` metadata on
    /// document keys (`.json` / `.html`), which are republished in place
    /// under stable keys, so browsers revalidate them on every use instead
    /// of trusting second-granularity `Last-Modified` freshness (#90).
    /// Image keys get no `Cache-Control` and keep long-lived caching.
    async fn put_object(&self, key: &str, data: Vec<u8>, public: bool) -> Result<(), S3Error>;

    /// Replace the `public=` tag on an existing object; `NotFound` if the
    /// object does not exist.
    async fn set_object_tagging(&self, key: &str, public: bool) -> Result<(), S3Error>;

    /// Read the `public=` tag of an existing object; `NotFound` if the object
    /// does not exist. An object with no `public` tag reads as private —
    /// the bucket policy only exposes `public=true`, so that matches what
    /// anonymous readers actually see.
    async fn get_object_public(&self, key: &str) -> Result<bool, S3Error>;

    /// Server-side copy within the bucket, preserving the `public=` tag;
    /// `NotFound` if `from` does not exist. Used by the image migration to
    /// move a legacy `images/<id>` object under its new `images/<id>/`
    /// prefix without downloading and re-uploading the bytes.
    async fn copy_object(&self, from: &str, to: &str) -> Result<(), S3Error>;

    /// Delete an object. Like S3, deleting a missing key is not an error.
    async fn delete_object(&self, key: &str) -> Result<(), S3Error>;

    /// List ALL objects under `prefix` (following pagination to the end).
    /// An empty result is a legitimate empty prefix, not an error.
    async fn list_objects(&self, prefix: &str) -> Result<Vec<ObjectMeta>, S3Error>;
}
