use axum::extract::Path;
use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::models::{BlogPost, BlogPostUpdate};
use crate::AppState;

pub async fn list_blog_posts_handler(State(state): State<AppState>) -> Json<Value> {
    match state.s3_service.get_object("blog-posts.json").await {
        Ok(data) => {
            let blog_posts_str = String::from_utf8(data).unwrap_or_default();
            println!("Blog posts data: {}", blog_posts_str);
            let blog_posts: Vec<BlogPost> =
                serde_json::from_str(&blog_posts_str).unwrap_or_default();
            Json(json!(blog_posts))
        }
        Err(e) => {
            eprintln!("Error fetching blog posts: {}", e);
            Json(json!([]))
        }
    }
}

pub async fn update_blog_posts_handler(
    State(state): State<AppState>,
    Json(blog_posts): Json<Vec<BlogPost>>,
) -> Json<Value> {
    let blog_posts_str = serde_json::to_string(&blog_posts).unwrap();

    match state
        .s3_service
        .put_object("blog-posts.json", blog_posts_str.as_bytes().to_vec(), true)
        .await
    {
        Ok(_) => Json(json!({"message": "Blog posts updated"})),
        Err(e) => {
            eprintln!("Error updating blog posts: {}", e);
            Json(json!({"error": "Failed to update blog posts"}))
        }
    }
}

// takes a blog post id, body is the new content as a string
pub async fn update_blog_post_content(
    State(state): State<AppState>,
    Json(blog_post_data): Json<BlogPostUpdate>,
) -> Json<Value> {
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
        Ok(_) => Json(json!({"message": "Blog post content updated"})),
        Err(e) => {
            eprintln!("Error updating blog post content: {}", e);
            Json(json!({"error": "Failed to update blog post content"}))
        }
    }
}

pub async fn get_blog_post_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let key = format!("blog/{}.html", id);
    match state.s3_service.get_object(&key).await {
        Ok(data) => {
            let content = String::from_utf8(data).unwrap_or_default();
            Json(json!({"content": content}))
        }
        Err(e) => {
            eprintln!("Error fetching blog post content: {}", e);
            Json(json!({"error": "Failed to fetch blog post content"}))
        }
    }
}

pub async fn delete_blog_post_content(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let key = format!("blog/{}.html", id);
    match state.s3_service.delete_object(&key).await {
        Ok(_) => Json(json!({"message": "Blog post deleted"})),
        Err(e) => {
            eprintln!("Error deleting blog post: {}", e);
            Json(json!({"error": "Failed to delete blog post"}))
        }
    }
}
