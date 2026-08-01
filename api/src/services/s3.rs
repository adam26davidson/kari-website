use aws_sdk_s3::error::SdkError;
use aws_sdk_s3::{primitives::ByteStream, Client};
use std::error::Error;
use std::fmt;

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

impl S3Service {
    pub fn new(client: Client, bucket_name: String) -> Self {
        Self {
            client,
            bucket_name,
        }
    }

    pub async fn get_object(&self, key: &str) -> Result<Vec<u8>, S3Error> {
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

    pub async fn put_object(&self, key: &str, data: Vec<u8>, public: bool) -> Result<(), S3Error> {
        // set tag public=
        self.client
            .put_object()
            .bucket(&self.bucket_name)
            .key(key)
            .body(ByteStream::from(data))
            .set_tagging(Some(format!("public={}", public)))
            .send()
            .await?;

        Ok(())
    }

    pub async fn set_object_tagging(&self, key: &str, public: bool) -> Result<(), S3Error> {
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

    pub async fn delete_object(&self, key: &str) -> Result<(), S3Error> {
        self.client
            .delete_object()
            .bucket(&self.bucket_name)
            .key(key)
            .send()
            .await?;

        Ok(())
    }
}
