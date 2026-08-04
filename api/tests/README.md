# API Testing Guide

Integration tests for the Kari Website API, organized by functionality area.
Each top-level file in this directory is compiled as its own test binary; shared
setup lives in `common/` (a subdirectory, so it is not compiled as a test on its
own).

## Running Tests

```bash
cargo test              # run all (non-ignored) tests
cargo test --test auth_tests   # run one test binary
cargo test -- --ignored        # run the opt-in live AWS test (needs credentials)
```

Before committing, also run (CI enforces both):

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

## Test Structure

- `common/mod.rs` — shared helpers: a throwaway RSA test keypair, a JWKS built
  from its public half, a `signed_token` factory, a dummy (offline) S3 client,
  and a real `AppState` builder.
- `common/store.rs` — `InMemoryStore`, an in-memory `ObjectStore` implementation
  mimicking S3 semantics, with failure injection (`set_failing`,
  `set_failing_puts`) and an `AppState` builder around it.
- `handler_tests.rs` — drives every route handler through the **real** router
  (auth included) against `InMemoryStore`: success, missing-object,
  corrupt-data, and S3-outage paths, plus health-probe caching and the
  publish-tag semantics of writes.
- `auth_tests.rs` — drives the **real** `middleware::auth::auth_middleware`
  against a real `AppState`. Signs tokens with the test key and asserts that
  valid tokens pass and that missing / malformed / expired / wrong-kid /
  wrong-audience / wrong-issuer tokens are rejected with 401.
- `route_tests.rs` — builds the **real** router from `routes::create_router` and
  verifies the secure/public split and the auth layer wiring.
- `model_tests.rs` — serde (de)serialization of the `models` types, guarding the
  `isPublished` camelCase wire contract shared with the frontend.
- `s3_service_tests.rs` — unit tests for the real `S3Error` type/formatting, plus
  an `#[ignore]`d end-to-end test against a live bucket.

## Principles

Per `api/CLAUDE.md`, tests exercise real source code — no parallel
re-implementations of the logic under test. The test keypair in `common/mod.rs`
is generated solely for tests and is not a real credential.

## Coverage

```bash
cargo llvm-cov --summary-only   # or --html for a browsable report
```

Handlers, router, and error type sit at ~92–100% line coverage. The gaps are
structural: `main.rs` (bootstrap wiring), the real AWS SDK calls in
`services/s3.rs` (exercised only by the `#[ignore]`d live-bucket test), and
practically unreachable error arms (e.g. `serde_json::to_string` failing on
plain structs).

## Future Work

- Mock the AWS SDK with `aws-smithy-mocks` to cover the `S3Service` SDK calls
  and the `From<SdkError>` 404 → `NotFound` mapping without hitting real AWS.
