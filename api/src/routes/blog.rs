use axum::extract::Path;
use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::{BlogPost, BlogPostUpdate};
use crate::services::s3::S3Error;
use crate::AppState;

const BLOG_POSTS_PUBLIC_KEY: &str = "blog-posts.json";
const BLOG_POSTS_ALL_KEY: &str = "blog-posts-all.json";

pub async fn list_blog_posts_handler(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    let blog_posts: Vec<BlogPost> = match state.s3_service.get_object(BLOG_POSTS_PUBLIC_KEY).await {
        // A parse failure must NOT become an empty list: the admin UI would
        // render an empty editor and a save would wipe the data.
        Ok(data) => serde_json::from_slice(&data)
            .map_err(|e| AppError::internal("Stored blog post data is invalid", e))?,
        // The object not existing yet is a legitimate empty list (new site).
        Err(S3Error::NotFound) => Vec::new(),
        Err(e) => return Err(AppError::internal("Failed to fetch blog posts", e)),
    };
    Ok(Json(json!(blog_posts)))
}

pub async fn update_blog_posts_handler(
    State(state): State<AppState>,
    Json(blog_posts): Json<Vec<BlogPost>>,
) -> Result<Json<Value>, AppError> {
    let all_posts_str = serde_json::to_string(&blog_posts)
        .map_err(|e| AppError::internal("Failed to serialize blog posts", e))?;

    // Private-first: if the second write fails, nothing draft-related has
    // been exposed; the admin retries and the public list catches up.
    state
        .s3_service
        .put_object(BLOG_POSTS_ALL_KEY, all_posts_str.into_bytes(), false)
        .await
        .map_err(|e| AppError::internal("Failed to update blog posts", e))?;

    let published: Vec<&BlogPost> = blog_posts.iter().filter(|p| p.is_published).collect();
    let published_str = serde_json::to_string(&published)
        .map_err(|e| AppError::internal("Failed to serialize public blog posts", e))?;

    state
        .s3_service
        .put_object(BLOG_POSTS_PUBLIC_KEY, published_str.into_bytes(), true)
        .await
        .map_err(|e| AppError::internal("Failed to update public blog posts", e))?;

    Ok(Json(json!({"message": "Blog posts updated"})))
}

// takes a blog post id, body is the new content as a string
pub async fn update_blog_post_content(
    State(state): State<AppState>,
    Json(blog_post_data): Json<BlogPostUpdate>,
) -> Result<Json<Value>, AppError> {
    let key = format!("blog/{}.html", blog_post_data.id);
    state
        .s3_service
        .put_object(
            &key,
            blog_post_data.content.into_bytes(),
            blog_post_data.is_published,
        )
        .await
        .map_err(|e| AppError::internal("Failed to update blog post content", e))?;

    Ok(Json(json!({"message": "Blog post content updated"})))
}

pub async fn get_blog_post_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let key = format!("blog/{}.html", id);
    match state.s3_service.get_object(&key).await {
        Ok(data) => {
            let content = String::from_utf8(data)
                .map_err(|e| AppError::internal("Stored blog post content is invalid", e))?;
            Ok(Json(json!({"content": content})))
        }
        // Distinguish missing content (the caller may tolerate it, e.g. when
        // deleting a post) from a failed fetch (which must abort the caller).
        Err(S3Error::NotFound) => Err(AppError::NotFound("Blog post content not found")),
        Err(e) => Err(AppError::internal("Failed to fetch blog post content", e)),
    }
}

pub async fn delete_blog_post_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let key = format!("blog/{}.html", id);
    state
        .s3_service
        .delete_object(&key)
        .await
        .map_err(|e| AppError::internal("Failed to delete blog post", e))?;

    Ok(Json(json!({"message": "Blog post deleted"})))
}
