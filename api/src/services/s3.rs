use async_trait::async_trait;
use aws_sdk_s3::error::SdkError;
use aws_sdk_s3::{primitives::ByteStream, Client};
use std::error::Error;
use std::fmt;
use std::time::SystemTime;

use crate::services::object_store::{ObjectMeta, ObjectStore};

#[derive(Debug)]
pub enum S3Error {
    NotFound,
    OperationFailed(String),
}

impl fmt::Display for S3Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            S3Error::NotFound => write!(f, "Resource not found"),
            S3Error::OperationFailed(err) => write!(f, "S3 operation failed: {}", err),
        }
    }
}

impl Error for S3Error {}

impl<E: std::fmt::Debug> From<SdkError<E>> for S3Error {
    fn from(err: SdkError<E>) -> Self {
        // Check if the error is a 404 Not Found
        if let SdkError::ServiceError(service_err) = &err {
            if service_err.raw().status().as_u16() == 404 {
                return S3Error::NotFound;
            }
        }
        // Debug-format the SdkError: its Display ("service error") hides the
        // underlying cause (e.g. AccessDenied), which makes failures undiagnosable
        // from the logs.
        S3Error::OperationFailed(format!("{:?}", err))
    }
}

pub struct S3Service {
    client: Client,
    bucket_name: String,
}

/// `Cache-Control` metadata to store on a newly written object, by key.
///
/// Published documents — the JSON manifests (`haiga.json`, `haiku.json`,
/// `photography.json`, `home-page.json`, `blog-posts.json`) and blog content
/// (`blog/<id>.html`) — are rewritten in place under stable keys and fetched
/// directly from S3 by the public pages. S3's `Last-Modified` has one-second
/// granularity, so when a save rewrites a document within the same second as
/// the previous write, `If-Modified-Since` revalidation answers `304 Not
/// Modified` forever and browsers keep serving the stale body (#90).
/// Storing `Cache-Control: no-cache` makes S3 serve that header, forcing the
/// browser to revalidate every use — and revalidation carries `If-None-Match`,
/// which takes precedence over `If-Modified-Since` (RFC 9110 §13.1.3). S3
/// ETags are content-based (MD5 for single-part puts), so any content change
/// misses the validator regardless of wall-clock timing; an identical body
/// yields a harmless 304 for identical content.
///
/// Everything else — most importantly images under `images/` — keeps the
/// default (no header) so long-lived browser caching is unchanged.
fn cache_control_for(key: &str) -> Option<&'static str> {
    if key.ends_with(".json") || key.ends_with(".html") {
        Some("no-cache")
    } else {
        None
    }
}

impl S3Service {
    pub fn new(client: Client, bucket_name: String) -> Self {
        Self {
            client,
            bucket_name,
        }
    }
}

#[async_trait]
impl ObjectStore for S3Service {
    async fn get_object(&self, key: &str) -> Result<Vec<u8>, S3Error> {
        let response = self
            .client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await?;

        let data = response.body.collect().await.map_err(|e| {
            S3Error::OperationFailed(format!("Failed to collect response body: {}", e))
        })?;

        Ok(data.to_vec())
    }

    async fn put_object(&self, key: &str, data: Vec<u8>, public: bool) -> Result<(), S3Error> {
        // set tag public=
        self.client
            .put_object()
            .bucket(&self.bucket_name)
            .key(key)
            .body(ByteStream::from(data))
            .set_cache_control(cache_control_for(key).map(String::from))
            .set_tagging(Some(format!("public={}", public)))
            .send()
            .await?;

        Ok(())
    }

    async fn set_object_tagging(&self, key: &str, public: bool) -> Result<(), S3Error> {
        self.client
            .put_object_tagging()
            .bucket(&self.bucket_name)
            .key(key)
            .tagging(
                aws_sdk_s3::types::Tagging::builder()
                    .tag_set(
                        aws_sdk_s3::types::Tag::builder()
                            .key("public")
                            .value(public.to_string())
                            .build()
                            .map_err(|e| {
                                S3Error::OperationFailed(format!("Failed to build tag: {e}"))
                            })?,
                    )
                    .build()
                    .map_err(|e| {
                        S3Error::OperationFailed(format!("Failed to build tagging: {e}"))
                    })?,
            )
            .send()
            .await?;

        Ok(())
    }

    async fn delete_object(&self, key: &str) -> Result<(), S3Error> {
        self.client
            .delete_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await?;

        Ok(())
    }

    async fn list_objects(&self, prefix: &str) -> Result<Vec<ObjectMeta>, S3Error> {
        let mut objects = Vec::new();
        let mut continuation_token: Option<String> = None;

        // Follow pagination to the end: a truncated listing that silently
        // stopped after one page would make every object on later pages look
        // deletable to the GC sweep.
        loop {
            let response = self
                .client
                .list_objects_v2()
                .bucket(&self.bucket_name)
                .prefix(prefix)
                .set_continuation_token(continuation_token.take())
                .send()
                .await?;

            for object in response.contents() {
                let Some(key) = object.key() else { continue };
                let last_modified = object
                    .last_modified()
                    .and_then(|dt| SystemTime::try_from(*dt).ok());
                objects.push(ObjectMeta {
                    key: key.to_string(),
                    last_modified,
                });
            }

            match response.next_continuation_token() {
                Some(token) => continuation_token = Some(token.to_string()),
                None => break,
            }
        }

        Ok(objects)
    }
}
