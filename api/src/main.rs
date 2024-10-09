use std::net::SocketAddr;

use axum::{
    routing::get,
    Router
};
use axum::response::Json;
use serde_json::{json, Value};
use serde::{Serialize, Deserialize};
use tower_http::cors::CorsLayer;

#[derive(Serialize, Deserialize)]
struct Haiku {
    id: i32,
    title: String,
    lines: Vec<String>,
    publisher: String,
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/test", get(|| async { "WHATS AAAAAP" }))
        .route("/haikus", get(haikus_handler))
        .layer(CorsLayer::permissive());
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn haikus_handler() -> Json<Value> {
    let haikus = vec![
        Haiku {
            id: 1,
            title: "Empty Pea Pods".to_string(),
            lines: vec!["what's left".to_string(), "of the afternoon".to_string(), "empty pea pods".to_string()],
            publisher: "placeholder publisher 1".to_string()
        }, Haiku {
            id: 2,
            title: "a child’s breath".to_string(),
            lines: vec!["first cherry blossoms".to_string(), "a child’s breath".to_string(), "on the windowpane".to_string()],
            publisher: "placeholder publisher 2".to_string()
        }, Haiku {
            id: 3,
            title: "drifting cherry petals".to_string(),
            lines: vec!["drifting cherry petals".to_string(), "for a moment".to_string(), "we let down our masks".to_string()],
            publisher: "placeholder publisher 3".to_string()
        }
    ];

    Json(json!(haikus))
}
