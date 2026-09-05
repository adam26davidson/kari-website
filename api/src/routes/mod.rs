pub mod blog;
pub mod haiga;
pub mod haiku;
pub mod health;
pub mod home;
pub mod images;
pub mod photography;
pub mod site_settings;
pub mod version;

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
    // The image upload is the ONLY route allowed a 25 MiB body. Everything
    // else keeps the 10 MiB it has always had: a blog post or a manifest
    // that large is a bug or an attack, and every byte accepted is a byte
    // buffered in memory on a micro EC2 host that runs two copies of this
    // API.
    //
    // 25 MiB covers a DSLR JPEG, which the admin now uploads untouched: the
    // browser-side downscale was removed in #453, so the original is the
    // source of truth and every rendition is derived here (#706). What the
    // upload then costs to DECODE is bounded separately — see
    // `MAX_DECODE_BYTES` and the rendition gate in `routes::images`.
    //
    // Two things outside this file are pinned to this number:
    //   - `MAX_UPLOAD_BYTES` in
    //     `ui/packages/shared/src/utils/background-image.ts` sits just
    //     BELOW it, so the admin gets a friendly "too big" message instead
    //     of a bare 413;
    //   - the deployed nginx vhosts' `client_max_body_size` must be at
    //     least this, or nginx rejects the upload before it arrives. Those
    //     vhosts are hand-maintained on the host, not in this repo (#714) —
    //     raise them alongside any change here.
    //
    // `GET /images` rides along only because axum cannot merge two routers
    // that each define `/images`; a GET carries no body, so the larger limit
    // is inert for it.
    let upload_routes = Router::new()
        .route("/images", post(images::upload_image_handler))
        .route("/images", get(images::list_images_handler))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(
            25 * 1024 * 1024, /* 25 MiB */
        ));

    let secure_routes = Router::new()
        .route("/haiku", put(haiku::update_haiku_handler))
        .route("/haiga", put(haiga::update_haiga_handler))
        .route("/photography", put(photography::update_photography_handler))
        .route("/photography", get(photography::get_photography_handler))
        .route("/home-page", put(home::update_home_page_handler))
        .route(
            "/site-settings",
            put(site_settings::update_site_settings_handler),
        )
        .route("/images/gc", post(images::gc_images_handler))
        .route(
            "/images/{filename}/set-published",
            put(images::set_image_published_handler),
        )
        .route("/blog", get(blog::list_blog_posts_handler))
        .route("/blog", put(blog::update_blog_posts_handler))
        .route("/blog-content", put(blog::update_blog_post_content))
        .route("/blog-content/{id}", get(blog::get_blog_post_content))
        .route("/blog-content/{id}", delete(blog::delete_blog_post_content))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024 /* 10mb */))
        // Applied to the merged router so auth still covers the upload
        // route, whose body limit had to be layered separately above.
        .merge(upload_routes)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::auth::auth_middleware,
        ));

    let public_routes = Router::new()
        .route("/images/{filename}", get(images::get_image_handler))
        .route("/haiku", get(haiku::get_haiku_handler))
        .route("/haiga", get(haiga::get_haiga_handler))
        .route("/home-page", get(home::get_home_page_handler))
        .route(
            "/site-settings",
            get(site_settings::get_site_settings_handler),
        )
        .route("/version", get(version::version_handler));

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
