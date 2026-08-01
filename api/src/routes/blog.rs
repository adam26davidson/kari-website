use axum::extract::Path;
use axum::{extract::State, http::StatusCode, response::Json};
use serde_json::{json, Value};

use crate::models::{BlogPost, BlogPostUpdate};
use crate::services::s3::S3Error;
use crate::AppState;

pub async fn list_blog_posts_handler(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match state.s3_service.get_object("blog-posts.json").await {
        Ok(data) => match serde_json::from_slice::<Vec<BlogPost>>(&data) {
            Ok(blog_posts) => (StatusCode::OK, Json(json!(blog_posts))),
            // A parse failure must NOT become an empty list: the admin UI
            // would render an empty editor and a save would wipe the data.
            Err(e) => {
                eprintln!("Error parsing blog-posts.json: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Stored blog post data is invalid"})),
                )
            }
        },
        // The object not existing yet is a legitimate empty list (new site).
        Err(S3Error::NotFound) => (StatusCode::OK, Json(json!([]))),
        Err(e) => {
            eprintln!("Error fetching blog posts: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to fetch blog posts"})),
            )
        }
    }
}

pub async fn update_blog_posts_handler(
    State(state): State<AppState>,
    Json(blog_posts): Json<Vec<BlogPost>>,
) -> (StatusCode, Json<Value>) {
    let blog_posts_str = serde_json::to_string(&blog_posts).unwrap();

    match state
        .s3_service
        .put_object("blog-posts.json", blog_posts_str.as_bytes().to_vec(), true)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"message": "Blog posts updated"})),
        ),
        Err(e) => {
            eprintln!("Error updating blog posts: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update blog posts"})),
            )
        }
    }
}

// takes a blog post id, body is the new content as a string
pub async fn update_blog_post_content(
    State(state): State<AppState>,
    Json(blog_post_data): Json<BlogPostUpdate>,
) -> (StatusCode, Json<Value>) {
    let content = blog_post_data.content.clone();
    let id = blog_post_data.id.clone();
    let key = format!("blog/{}.html", id);
    match state
        .s3_service
        .put_object(
            &key,
            content.as_bytes().to_vec(),
            blog_post_data.is_published,
        )
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"message": "Blog post content updated"})),
        ),
        Err(e) => {
            eprintln!("Error updating blog post content: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update blog post content"})),
            )
        }
    }
}

pub async fn get_blog_post_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<Value>) {
    let key = format!("blog/{}.html", id);
    match state.s3_service.get_object(&key).await {
        Ok(data) => match String::from_utf8(data) {
            Ok(content) => (StatusCode::OK, Json(json!({"content": content}))),
            Err(e) => {
                eprintln!("Error decoding blog post content {}: {}", key, e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Stored blog post content is invalid"})),
                )
            }
        },
        // Distinguish missing content (the caller may tolerate it, e.g. when
        // deleting a post) from a failed fetch (which must abort the caller).
        Err(S3Error::NotFound) => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Blog post content not found"})),
        ),
        Err(e) => {
            eprintln!("Error fetching blog post content: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to fetch blog post content"})),
            )
        }
    }
}

pub async fn delete_blog_post_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> (StatusCode, Json<Value>) {
    let key = format!("blog/{}.html", id);
    match state.s3_service.delete_object(&key).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"message": "Blog post deleted"})),
        ),
        Err(e) => {
            eprintln!("Error deleting blog post: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to delete blog post"})),
            )
        }
    }
}
