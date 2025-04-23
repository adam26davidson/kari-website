pub mod haiku;
pub mod haiga;
pub mod home;
pub mod images;

use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, post, put},
    Router,
};
use tower_http::limit::RequestBodyLimitLayer;

use crate::AppState;

pub fn create_router(state: AppState) -> Router {
    let secure_routes = Router::new()
        .route("/haiku", put(haiku::update_haiku_handler))
        .route("/haiga", put(haiga::update_haiga_handler))
        .route("/home-page", put(home::update_home_page_handler))
        .route("/images", post(images::upload_image_handler))
        .route("/images/:filename", delete(images::delete_image_handler))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024 /* 10mb */))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::auth::auth_middleware,
        ));

    let public_routes = Router::new()
        .route("/haiku", get(haiku::get_haiku_handler))
        .route("/haiga", get(haiga::get_haiga_handler))
        .route("/home-page", get(home::get_home_page_handler))
        .route("/images/:filename", get(images::get_image_handler));

    Router::new()
        .merge(secure_routes)
        .merge(public_routes)
        .with_state(state)
}