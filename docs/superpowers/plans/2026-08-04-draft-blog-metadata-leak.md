# Draft Blog Metadata Leak Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop unpublished blog post metadata from being publicly readable in S3 by splitting the stored list into a private full list and a public published-only list (issue #26, spec: `docs/superpowers/specs/2026-08-04-draft-blog-metadata-leak-design.md`).

**Architecture:** `PUT /blog` writes the full list (drafts included) to a new private object `blog-posts-all.json`, then a filtered published-only list to the existing public `blog-posts.json` — private-first so a partial failure never exposes a draft. The authenticated `GET /blog` reads the private object, falling back to the legacy `blog-posts.json` until the first post-deploy save creates it. No UI, model, or route changes.

**Tech Stack:** Rust (axum), handler tests in `api/tests/handler_tests.rs` against the in-memory `ObjectStore` (`api/tests/common/store.rs`).

## Global Constraints

- API must compile with no warnings: `cargo clippy --all-targets -- -D warnings` (CI-enforced)
- `cargo fmt --check` must pass
- All commands run from `api/`
- The camelCase `isPublished` wire contract with the frontend must be preserved (already pinned by `blog_posts_round_trip_preserving_wire_format`)
- A parse failure of stored data must be a 500, never an empty list (wipe protection — pinned by `list_blog_posts_corrupt_data_is_500_not_empty_list`)

---

### Task 1: Split write path — private full list + public published-only list

**Files:**
- Modify: `api/src/routes/blog.rs:25-39` (`update_blog_posts_handler`)
- Test: `api/tests/handler_tests.rs` (blog section, after `sample_blog_posts()` around line 342)

**Interfaces:**
- Consumes: `ObjectStore::put_object(key: &str, data: Vec<u8>, public: bool)`; `BlogPost { id, title, date, is_published }` (serde-renamed `isPublished`)
- Produces: S3 keys `blog-posts-all.json` (private, full list) and `blog-posts.json` (public, published only) — Task 2's read path depends on these exact keys. Also `mixed_blog_posts()` test fixture reused by Task 2.

- [ ] **Step 1: Write the failing test**

Add to the blog section of `api/tests/handler_tests.rs` (near `sample_blog_posts()`):

```rust
fn mixed_blog_posts() -> Value {
    json!([
        {"id": "b1", "title": "Hello", "date": "2026-08-04", "isPublished": true},
        {"id": "b2", "title": "Secret draft", "date": "2026-08-05", "isPublished": false}
    ])
}

#[tokio::test]
async fn update_blog_posts_splits_private_full_and_public_published_lists() {
    let (store, app) = setup();
    let (status, _) = send(app, put_json("/blog", mixed_blog_posts())).await;
    assert_eq!(status, StatusCode::OK);

    // Full list, drafts included, must be stored privately.
    let all = store.get("blog-posts-all.json").expect("private list stored");
    assert!(!all.public);
    assert_eq!(
        serde_json::from_slice::<Value>(&all.data).unwrap(),
        mixed_blog_posts()
    );

    // The public object must contain ONLY published posts (this is the leak).
    let public = store.get("blog-posts.json").expect("public list stored");
    assert!(public.public);
    assert_eq!(
        serde_json::from_slice::<Value>(&public.data).unwrap(),
        json!([{"id": "b1", "title": "Hello", "date": "2026-08-04", "isPublished": true}])
    );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test handler_tests update_blog_posts_splits -- --nocapture`
Expected: FAIL with `private list stored` panic (no `blog-posts-all.json` object exists).

- [ ] **Step 3: Write minimal implementation**

Replace `update_blog_posts_handler` in `api/src/routes/blog.rs` and add key constants at the top of the file (below the `use` block):

```rust
const BLOG_POSTS_PUBLIC_KEY: &str = "blog-posts.json";
const BLOG_POSTS_ALL_KEY: &str = "blog-posts-all.json";
```

```rust
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
```

Also replace the two remaining `"blog-posts.json"` literals in this file (in `list_blog_posts_handler`) with `BLOG_POSTS_PUBLIC_KEY` — behavior unchanged in this task.

- [ ] **Step 4: Run the full API test suite**

Run: `cargo test`
Expected: all tests PASS. In particular `blog_posts_round_trip_preserving_wire_format` still passes (its sample post is published, so the filtered public object equals the input) and `update_blog_posts_store_outage_is_500` still passes (the first, private write fails with the same message as before).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/blog.rs api/tests/handler_tests.rs
git commit -m "Write draft-free public blog list alongside private full list (#26)"
```

---

### Task 2: Read path — admin list from private key with legacy fallback

**Files:**
- Modify: `api/src/routes/blog.rs:10-23` (`list_blog_posts_handler`)
- Test: `api/tests/handler_tests.rs` (blog section)

**Interfaces:**
- Consumes: `BLOG_POSTS_ALL_KEY` / `BLOG_POSTS_PUBLIC_KEY` constants and `mixed_blog_posts()` fixture from Task 1; `ObjectStore::get_object(key) -> Result<Vec<u8>, S3Error>`; `S3Error::NotFound`; `InMemoryStore::with_object(key, data)` seeding (tags the object public, which matches the legacy state).
- Produces: final `GET /blog` behavior — private-first read, legacy fallback, `[]` only when neither object exists.

- [ ] **Step 1: Write the two failing tests**

```rust
#[tokio::test]
async fn list_blog_posts_returns_drafts_after_split_write() {
    let (_, app) = setup();
    send(app.clone(), put_json("/blog", mixed_blog_posts())).await;
    // The admin list must come from the private full list, drafts included —
    // not the filtered public object.
    assert_eq!(
        send(app, get_auth("/blog")).await,
        (StatusCode::OK, mixed_blog_posts())
    );
}

#[tokio::test]
async fn list_blog_posts_falls_back_to_legacy_object() {
    // Pre-migration state: only the old single public object exists.
    let (_, app) = setup_with(
        InMemoryStore::default().with_object("blog-posts.json", mixed_blog_posts().to_string()),
    );
    assert_eq!(
        send(app, get_auth("/blog")).await,
        (StatusCode::OK, mixed_blog_posts())
    );
}
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `cargo test --test handler_tests list_blog_posts -- --nocapture`
Expected: `list_blog_posts_returns_drafts_after_split_write` FAILS (GET still reads the filtered public object, so the draft is missing). `list_blog_posts_falls_back_to_legacy_object` PASSES for now (the old read path happens to be the fallback path) — it exists to pin the fallback once the read path flips.

- [ ] **Step 3: Write the implementation**

Replace `list_blog_posts_handler` in `api/src/routes/blog.rs`:

```rust
pub async fn list_blog_posts_handler(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    let data = match state.s3_service.get_object(BLOG_POSTS_ALL_KEY).await {
        Ok(data) => Some(data),
        // Legacy single-object layout from before the public/private split:
        // present until the first save after this change deploys.
        Err(S3Error::NotFound) => {
            match state.s3_service.get_object(BLOG_POSTS_PUBLIC_KEY).await {
                Ok(data) => Some(data),
                // Neither object existing is a legitimate empty list (new site).
                Err(S3Error::NotFound) => None,
                Err(e) => return Err(AppError::internal("Failed to fetch blog posts", e)),
            }
        }
        Err(e) => return Err(AppError::internal("Failed to fetch blog posts", e)),
    };

    let blog_posts: Vec<BlogPost> = match data {
        // A parse failure must NOT become an empty list: the admin UI would
        // render an empty editor and a save would wipe the data.
        Some(data) => serde_json::from_slice(&data)
            .map_err(|e| AppError::internal("Stored blog post data is invalid", e))?,
        None => Vec::new(),
    };
    Ok(Json(json!(blog_posts)))
}
```

- [ ] **Step 4: Run the full API test suite**

Run: `cargo test`
Expected: all PASS, including the pre-existing pins: `list_blog_posts_returns_empty_list_when_absent` (both objects missing → `[]`), `list_blog_posts_corrupt_data_is_500_not_empty_list` (corrupt legacy object now exercises the fallback arm → still 500), `blog_posts_round_trip_preserving_wire_format` (GET now reads the private object written by PUT), and `list_blog_posts_store_outage_is_500` (outage on the first get → 500).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/blog.rs api/tests/handler_tests.rs
git commit -m "Read admin blog list from private object with legacy fallback (#26)"
```

---

### Task 3: Full verification

**Files:** none new — verification only.

**Interfaces:**
- Consumes: everything above.
- Produces: a branch ready for review/merge.

- [ ] **Step 1: Run the complete API check set**

Run (from `api/`): `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: all three exit 0. If `cargo fmt --check` fails, run `cargo fmt`, re-run the checks, and amend the last commit with the formatting.

- [ ] **Step 2: Run the UI test suite to confirm no UI impact**

Run (from `ui/`): `npm run test:run`
Expected: PASS unchanged — `blog.test.ts` pins the client-side `isPublished` filter, which this change deliberately leaves in place as defense in depth.

- [ ] **Step 3: Commit any residue and confirm clean tree**

Run: `git status`
Expected: clean working tree, all work committed.
