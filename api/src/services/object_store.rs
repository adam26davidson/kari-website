//! Storage abstraction the handlers and health probe depend on.
//!
//! Everything downstream of `AppState` talks to `dyn ObjectStore` instead of
//! the concrete S3 client, so integration tests can substitute an in-memory
//! implementation. `S3Service` is the only production implementation.

use async_trait::async_trait;
use bytes::Bytes;
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
    ///
    /// Takes [`Bytes`] rather than `Vec<u8>` so an upload's body is buffered
    /// exactly once: the image handler has to keep the bytes for rendition
    /// generation as well as for this put, and with `Bytes` that second
    /// handle is a refcount bump instead of a second 25 MB allocation on a
    /// host with ~1 GiB of RAM. `ByteStream::from(Bytes)` is zero-copy too,
    /// and `Bytes::from` is zero-copy from both `Vec<u8>` and `String`, so
    /// the document callers pay nothing for the change.
    async fn put_object(&self, key: &str, data: Bytes, public: bool) -> Result<(), S3Error>;

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
