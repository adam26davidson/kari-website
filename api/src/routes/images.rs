use aws_sdk_s3::primitives::ByteStream;
use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::{models::IsPublishedQuery, AppState};

pub async fn get_image_handler(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> impl IntoResponse {
    let image_key = format!("images/{}", filename);

    match state.s3_service.get_object(&image_key).await {
        Ok(bytes) => {
            let content_type = mime_guess::from_path(&filename).first_or_octet_stream();
            (
                StatusCode::OK,
                [("Content-Type", content_type.as_ref())],
                bytes,
            )
                .into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Image not found").into_response(),
    }
}

#[axum::debug_handler]
pub async fn upload_image_handler(
    State(state): State<AppState>,
    Query(query): Query<IsPublishedQuery>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // extract "isPublished" from query string
    let is_published = query.is_published;

    // Pull out the first field
    let mut field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        Ok(None) => return (StatusCode::BAD_REQUEST, "No file found").into_response(),
        Err(e) => {
            eprintln!("Error reading multipart field: {}", e);
            return (StatusCode::BAD_REQUEST, "Invalid multipart").into_response();
        }
    };

    // Get original filename
    let file_name = field
        .file_name()
        .map(|n| n.to_string())
        .unwrap_or_else(|| "upload_file".to_string());
    let key = format!("images/{}", file_name);

    // Read entire stream into a Vec<u8>
    let mut data = Vec::new();
    while let Ok(Some(chunk)) = field.chunk().await {
        data.extend_from_slice(&chunk);
    }

    // Upload to S3
    match state
        .s3_client
        .put_object()
        .bucket(&state.bucket_name)
        .key(&key)
        .body(ByteStream::from(data))
        .set_tagging(Some(format!("public={}", is_published)))
        .send()
        .await
    {
        Ok(_) => {
            println!("File uploaded successfully: {}", file_name);
            (StatusCode::OK, "File uploaded successfully").into_response()
        }
        Err(err) => {
            eprintln!("PutObject error: {:?}", err);
            (StatusCode::INTERNAL_SERVER_ERROR, "Upload failed").into_response()
        }
    }
}

pub async fn set_image_published_handler(
    State(state): State<AppState>,
    Path(filename): Path<String>,
    Query(query): Query<IsPublishedQuery>,
) -> impl IntoResponse {
    let image_key = format!("images/{}", filename);
    let is_published = query.is_published;

    match state
        .s3_client
        .put_object_tagging()
        .bucket(&state.bucket_name)
        .key(&image_key)
        .tagging(
            aws_sdk_s3::types::Tagging::builder()
                .tag_set(
                    aws_sdk_s3::types::Tag::builder()
                        .key("public")
                        .value(is_published.to_string())
                        .build()
                        .expect("Failed to build tag"),
                )
                .build()
                .expect("Failed to build tagging"),
        )
        .send()
        .await
    {
        Ok(_) => (StatusCode::OK, "Image published status updated").into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Image not found").into_response(),
    }
}

pub async fn delete_image_handler(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> impl IntoResponse {
    let image_key = format!("images/{}", filename);

    match state.s3_service.delete_object(&image_key).await {
        Ok(_) => (StatusCode::OK, "Image deleted successfully").into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "Image not found").into_response(),
    }
}
