pub mod blog;
pub mod haiga;
pub mod haiku;
pub mod health;
pub mod home;
pub mod images;
pub mod photography;

use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, post, put},
    Router,
};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;

use crate::AppState;

pub fn create_router(state: AppState) -> Router {
    let secure_routes = Router::new()
        .route("/haiku", put(haiku::update_haiku_handler))
        .route("/haiga", put(haiga::update_haiga_handler))
        .route("/photography", put(photography::update_photography_handler))
        .route("/photography", get(photography::get_photography_handler))
        .route("/home-page", put(home::update_home_page_handler))
        .route("/images", post(images::upload_image_handler))
        .route("/images/gc", post(images::gc_images_handler))
        .route("/images/:filename", delete(images::delete_image_handler))
        .route(
            "/images/:filename/set-published",
            put(images::set_image_published_handler),
        )
        .route("/blog", get(blog::list_blog_posts_handler))
        .route("/blog", put(blog::update_blog_posts_handler))
        .route("/blog-content", put(blog::update_blog_post_content))
        .route("/blog-content/:id", get(blog::get_blog_post_content))
        .route("/blog-content/:id", delete(blog::delete_blog_post_content))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024 /* 10mb */))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::auth::auth_middleware,
        ));

    let public_routes = Router::new()
        .route("/images/:filename", get(images::get_image_handler))
        .route("/haiku", get(haiku::get_haiku_handler))
        .route("/haiga", get(haiga::get_haiga_handler))
        .route("/home-page", get(home::get_home_page_handler));

    Router::new()
        .merge(secure_routes)
        .merge(public_routes)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        // Registered after the trace layer on purpose: Route 53 checkers hit
        // /health ~once a second, which would drown the request log.
        .route("/health", get(health::health_handler))
        .with_state(state)
}
