# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- UI: `npm run dev` - Start development server
- UI: `npm run build` - Build production UI
- UI: `npm run build:test` - Build UI for test environment
- UI: `npm run lint` - Lint TypeScript code
- API: `cargo watch -x 'run dev'` - Run API in watch mode
- API: `cargo build` - Build the Rust API

## Test Commands
- UI: `npm run test` - Vitest in watch mode
- UI: `npm run test:run` - Vitest once (used in CI)
- UI: `npm run test:coverage` - Vitest with coverage
- UI: `npm run test:e2e` - Playwright e2e tests (builds the test-mode bundle,
  previews it, and runs smoke + visitor journeys against the test S3 bucket;
  admin journeys additionally run when `E2E_AUTH0_USERNAME` /
  `E2E_AUTH0_PASSWORD` are set, as they are in CI). The API must be running
  on localhost:3000: locally `aws sso login`, then `cargo run` in `api/`
  (its `.env` already targets the test bucket); CI builds and starts it
  itself using the OIDC-assumed `kari-website-e2e` role
- API: `cargo test` - Run Rust integration tests
- API: `cargo llvm-cov --summary-only` - Coverage report (needs cargo-llvm-cov)
- API: `cargo clippy --all-targets -- -D warnings` - Lint (CI enforces no warnings)
- API: `cargo fmt --check` - Formatting check

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request,
and a `coverage` job posts a whole-codebase coverage comment on each PR
(per-file breakdown in the job summary). Coverage is measured over ALL
source files, not a curated subset — don't narrow the scope.
Coverage thresholds are a ratchet: floors pinned just below current numbers
(UI: `coverage.thresholds` in `ui/vitest.config.ts`; API: `--fail-under-lines`
in the coverage CI job). When coverage rises meaningfully, bump the floors in
the same PR — never lower them to make a PR pass.
Dependency updates are managed by Renovate (`renovate.json`); non-major updates
auto-merge once these checks pass.

## Working on GitHub Issues
- Before starting work on an issue, add the `in progress` label and leave a
  comment naming your branch, so parallel sessions don't pick up the same
  issue. Skip issues already labeled `in progress`.
- Put `Closes #N` in the PR body. From PR-open onward the issue-lifecycle
  workflow (`.github/workflows/issue-lifecycle.yml`) owns the label: it
  re-adds `in progress` on PR open and removes it when the PR merges or is
  closed without merging. Merging also auto-closes the issue (native GitHub
  behavior) — no manual label cleanup needed once a PR exists.
- Caveat: GitHub only creates closing references for PRs based on `main`, so
  for a stacked PR keep the label manual until the PR retargets to `main`
  (retargeting fires the workflow, which takes over from there).

## Code Style Guidelines
- TypeScript: Use strict typing with interfaces (see Models.ts)
- React components: Use functional components with typed props
- CSS: Each component has its own CSS file
- Formatting: 2 space indentation, 80 character line width
- Component file naming: lowercase with extension matching content (.tsx, .css)
- Directory naming: camelCase for components
- Error handling: Proper type checking and error handling

## AWS Integration
- Login: `aws sso login` before running API locally
- S3 sync: `./scripts/sync_s3_prod_to_test.sh` to sync production S3 to test