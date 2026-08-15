# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- `./scripts/dev.sh` - Start the whole dev stack (MinIO + seed + API + UI);
  `--aws` targets the real test bucket via SSO instead of local MinIO
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
- UI: `npm run test:e2e` - Playwright e2e tests (seeds a local S3, builds the
  test-mode bundle, previews it, and runs smoke + visitor journeys; admin
  journeys additionally run when `E2E_AUTH0_USERNAME` / `E2E_AUTH0_PASSWORD`
  are set, as they are in CI). The stack is fully local and hermetic — no
  AWS account or shared bucket. Two things must be running:
  1. a throwaway MinIO standing in for S3:
     `docker compose up -d --wait minio` (defined in `docker-compose.yml`;
     `./scripts/dev.sh` starts this too, so a running dev stack already
     satisfies both prerequisites)
  2. the API on localhost:3000: `cargo run` in `api/` (its `.env` already
     targets the local MinIO; run `node e2e/seed.mjs` in `ui/` first so the
     bucket exists for the API's health probe)
  CI starts both itself; `ui/e2e/seed.mjs` (re-run on every `test:e2e`)
  seeds deterministic fixture content, so results never depend on what
  happens to be in a real bucket
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

## Visual Checks (required for UI changes)
Tests assert behavior, not appearance — features have shipped green while an
image overflowed its card or text was illegible against the background. So
after ANY change that can affect how the UI looks (components, CSS, layout,
`index.html`, UI dependency bumps), before claiming the work is done or
opening a PR:
1. With the dev stack running (`./scripts/dev.sh`), run
   `node e2e/screenshots.mjs` in `ui/` (add `--routes /,/haiku` to limit to
   affected pages; `--base-url` to target a non-default server). Full-page
   desktop + mobile PNGs land in `ui/e2e/screenshots/`.
2. Actually LOOK at each screenshot (Read the PNG files) and check for:
   content overflowing its container, clipped/squashed/stretched images,
   text that is hard to read against its actual rendered background,
   overlapping elements, and broken layout at the 390px mobile width.
3. Fix what you find and re-capture until the pages look right. Mention in
   the PR that the visual check was done and what it covered.

CI runs the same check on PRs touching `ui/**`
(`.github/workflows/visual-review.yml`): it captures the same screenshots
against the seeded e2e stack and Claude reviews them, posting an advisory
sticky PR comment (needs a `CLAUDE_CODE_OAUTH_TOKEN` repo secret — Claude
Pro/Max subscription, preferred — or `ANTHROPIC_API_KEY`; skips with a
notice when neither exists). Advisory means treat findings as a reviewer's
notes —
address or explicitly dismiss them, but the job never blocks a merge.

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

## Parallel Sessions / Multiple Open PRs
- If two issues need edits to the same files, work them in ONE branch/PR
  (multiple `Closes #N` lines in the body) instead of in parallel — the label
  convention above prevents duplicate pickup but not file collisions.
- When multiple sessions share one clone concurrently, each session must
  create its own worktree for its branch and work only there.
  Never run `git checkout`/`git switch` in the shared tree — concurrent
  checkouts move HEAD out from under other sessions, so commits land on the
  wrong branch, sweep in foreign files, or clobber uncommitted work.
- Standard worktree location: a sibling directory of the main clone, named
  `kari-website-<short-name>` (e.g.
  `git worktree add ../kari-website-admin-routes -b <branch> origin/main`).
  Sibling dirs are easy to reach and can't be swept up by tools that walk
  the repo tree (`grep -r`, test globs, docker build contexts). Don't put
  worktrees inside the repo; harness-managed ones under `.claude/worktrees/`
  are the exception — leave those to the tooling that created them.
- Commit only explicitly listed paths (`git add <paths>`, never `git add -A`
  in a shared tree); treat any file outside your issue's scope as owned by
  another session.
- Before pushing UI changes, run `npm run test:coverage`, not just
  `npm run test:run` — the CI coverage job enforces the ratchet floors and
  plain test runs won't catch a floor breach. Adding conditional logic can
  lower the branch percentage even when every test passes.
- The coverage floors in `ui/vitest.config.ts` are the most conflict-prone
  lines in the repo when several PRs are open. If two PRs both bump them,
  whichever merges second must re-measure on the merged tree
  (`npm run test:coverage`) and set floors just below the NEW actuals —
  don't blindly keep either side of the conflict.
- PRs are squash-merged; write PR titles that work as commit subjects.
- CI retriggers: the GitHub App used by Claude sessions cannot call the
  Actions re-run API (403). To re-run CI (e.g. after a GitHub outage), push
  an empty commit to the PR branch. Before debugging a "failed" run, check
  whether every job died in "Set up job" — that's GitHub infrastructure,
  not the PR.

## Code Style Guidelines
- TypeScript: Use strict typing with interfaces (see models.ts)
- React components: Use functional components with typed props
- CSS: Each component has its own CSS file
- Formatting: 2 space indentation, 80 character line width
- File naming: kebab-case with extension matching content (.tsx, .css)
- Directory naming: kebab-case for component directories and files
- Exports: named exports only (no default exports)
- Error handling: Proper type checking and error handling

## AWS Integration
- Login: `aws sso login` before running API locally
- S3 sync: `./scripts/sync_s3_prod_to_test.sh` to sync production S3 to test
- Image GC: `POST /images/gc` (admin JWT) sweeps orphaned `images/` objects.
  Dry-run by default; pass `?dry_run=false` to actually delete. Objects
  modified within the last hour are always skipped (in-flight uploads), and
  any manifest fetch/parse failure aborts the sweep before anything is deleted.