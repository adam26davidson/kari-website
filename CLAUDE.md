# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

## Build Commands
- `./scripts/setup-worktree.sh` - One-time setup for a fresh worktree (UI
  dependencies + the Playwright browser the visual check needs). Idempotent
  and cheap to re-run; see Parallel Sessions below.
- `./scripts/dev.sh` - Start the whole dev stack (MinIO + seed + API + UI);
  `--aws` targets the real test bucket via SSO instead of local MinIO. It
  runs `setup-worktree.sh` first, so a stack always starts against
  lockfile-matching dependencies; that script's skip check keeps a warm
  start cheap.
  Stacks are per-worktree: compose's directory-based project naming keeps
  each worktree's MinIO container separate, and dev.sh uses the default
  ports (MinIO 9000, API 3000) when free but picks free ports otherwise
  (override with `KARI_MINIO_PORT` / `KARI_API_PORT`; `KARI_MINIO_PORT=0`
  means ephemeral). It prints the chosen URLs at startup and wires them
  into the UI/API via env vars, so N stacks can run in parallel and
  `docker compose down` in one worktree never touches another's stack.
- UI: `npm run dev` - Start development server (like the rest of the local
  toolchain it targets the local MinIO + localhost:3000 API from
  `.env.development`; the real AWS test bucket is opt-in via
  `./scripts/dev.sh --aws` — no vite mode silently reads AWS)
- UI: `npm run build` - Build production UI
- UI: `npm run build:test` - Build UI for test environment
- UI: `npm run lint` - Lint TypeScript code
- UI: `npm run typecheck` - Type-check app code, tests and the vite
  configs (`tsc -b`; every project sets `noEmit`, so nothing is written).
  CI's Frontend job runs it as its own step, so a type error is named
  rather than buried in a build failure. `npm run typecheck:e2e` covers the
  Playwright specs, which are a separate TS project.
- API: `cargo watch -x 'run dev'` - Run API in watch mode
- API: `cargo build` - Build the Rust API

## Dependency Install Scripts
npm 12 (what recent Node ships locally) blocks a dependency's install
scripts unless `allowScripts` in `ui/package.json` covers it, and ends the
install with a warning naming everything it skipped. Every dependency that
ships one is recorded there as `false` — reviewed and denied, not
overlooked: the four `@fortawesome/*` scripts and `browser-tabs-lock`'s only
`console.log` a banner, `@swc/core`'s quietly swaps in a `@swc/wasm`
fallback we would rather fail loudly without, and `esbuild`'s can fetch a
binary over the network that the lockfile's platform package already
provides. Nothing needs to run, so `npm ci` is warning-free.
That is the point of recording them: a warning appearing again means a NEW
script arrived. Review it — `npm install-scripts ls` lists it — then
`npm install-scripts deny <pkg>` (or `approve <pkg>`, if it genuinely must
run) and commit the `package.json` change. Never silence it with
`--dangerously-allow-all-scripts`. CI is on Node 22 / npm 10, which predates
the field and ignores it, so this is about local output and local intent.

## Test Commands
- UI: `npm run test` - Vitest in watch mode
- UI: `npm run test:run` - Vitest once (used in CI)
- UI: `npm run test:coverage` - Type-check (`npm run typecheck`), then
  vitest with coverage. The typecheck runs first because this is the
  documented pre-push command (see Parallel Sessions below), so the check
  is mechanical rather than remembered; `npm run test` / `test:run` stay
  typecheck-free to keep the inner loop fast.
  The vitest suite is split into two projects (`ui/vitest.workspace.ts`):
  `unit` (jsdom) for app code, and `config` (node) for tests that assert on
  this package's own tooling. Config-level tests go in
  `ui/src/test/config/`; everything else defaults to `unit`. Coverage stays
  configured once in `ui/vitest.config.ts` and is measured across both.
- UI: `npm run test:e2e` - Playwright e2e tests (seeds a local S3, builds the
  test-mode bundle, previews it, and runs smoke + visitor journeys; admin
  journeys additionally run when `E2E_AUTH0_USERNAME` / `E2E_AUTH0_PASSWORD`
  are set, as they are in CI). The stack is fully local and hermetic — no
  AWS account or shared bucket. Two things must be running:
  1. a throwaway MinIO standing in for S3, on host port 9000 (the default):
     `docker compose up -d --wait minio` (defined in `docker-compose.yml`)
  2. the API on localhost:3000: `cargo run` in `api/` (its `.env` already
     targets the local MinIO; run `node e2e/seed.mjs` in `ui/` first so the
     bucket exists for the API's health probe)
  A dev stack started by `./scripts/dev.sh` satisfies both prerequisites
  when it got the default ports (it prints which ports it chose). Against a
  stack on non-default ports, export `VITE_S3_URL` / `VITE_API_URL` when
  running `test:e2e` — env vars override `.env.test` for the seeds, specs,
  and the built bundle alike.
  CI starts both itself; `ui/e2e/seed.mjs` (re-run on every `test:e2e`)
  seeds deterministic fixture content, so results never depend on what
  happens to be in a real bucket
- API: `cargo test` - Run Rust integration tests
- API: `cargo llvm-cov --summary-only` - Coverage report (needs cargo-llvm-cov)
- API: `cargo clippy --all-targets -- -D warnings` - Lint (CI enforces no
  warnings)
- API: `cargo fmt --check` - Formatting check
- Workflows + shell: `./scripts/lint-workflows.sh` - four checks:
  actionlint over `.github/` (schema, action inputs, `${{ }}` expressions,
  shellcheck over every embedded `run:` script); every job sets a job-level
  `timeout-minutes`; shellcheck over every `*.sh` in the repo; and every
  pinned docker image in those scripts carries the
  `# renovate: datasource=docker` comment that `renovate.json`'s
  customManager keys off (without it the pin is invisible to Renovate).
  Nothing to install — actionlint, shellcheck and yq each fall back to a
  pinned docker image when the binary is missing, so there is never a
  reason to hand-roll a `docker run koalaman/shellcheck` of your own. This
  is the script CI's `shell-lint` job runs, so run it locally before
  pushing any change to a `*.sh` file or to `.github/workflows/*`.
  CI runs it as `--images`, which ignores installed binaries and uses the
  pins for every tool; an installed shellcheck is whatever release the
  machine has, and releases disagree about real findings (0.9 reds a trap
  handler as SC2317 that the pinned 0.11 reports as SC2329). So if a local
  run disagrees with CI, re-run with `--images` (or
  `KARI_LINT_FORCE_IMAGES=1`) — that, not your `shellcheck --version`, is
  the definition of clean. That
  job also runs the shell test harnesses `automation/dispatch-test.sh`,
  `scripts/setup-worktree-test.sh` and `scripts/lint-workflows-test.sh`.
  Changing the lint script? Re-run its tests:
  `bash scripts/lint-workflows-test.sh` (needs jq plus either python3 +
  PyYAML or a real mikefarah yq, whichever the machine has)

CI (`.github/workflows/ci.yml`) runs all of the above on every pull request,
and a `coverage` job posts a whole-codebase coverage comment on each PR
(per-file breakdown in the job summary). Coverage is measured over ALL
source files, not a curated subset — don't narrow the scope.
Coverage thresholds are a ratchet: floors pinned just below current numbers
(UI: `coverage.thresholds` in `ui/vitest.config.ts`; API: `--fail-under-lines`
in the coverage CI job). When coverage rises meaningfully, bump the floors in
the same PR — never lower them to make a PR pass.
Dependency updates are managed by Renovate (`renovate.json`); non-major updates
auto-merge once these checks pass. To validate that file, pin the version —
`npx --yes --package renovate@latest renovate-config-validator renovate.json`.
A bare `--package renovate` can resolve a stale cached major that rejects
current config keys (a renovate 37 in the npx cache rejected
`managerFilePatterns`).

## Visual Checks (required for UI changes)
Tests assert behavior, not appearance — features have shipped green while an
image overflowed its card or text was illegible against the background. So
after ANY change that can affect how the UI looks (components, CSS, layout,
`index.html`, UI dependency bumps), before claiming the work is done or
opening a PR:
1. In a freshly created worktree, run `./scripts/setup-worktree.sh` first —
   nothing installable is shared from the main clone, and the capture script
   fails without it (details under Parallel Sessions below). Then, with the
   dev stack running (`./scripts/dev.sh`), run `node e2e/screenshots.mjs` in
   `ui/` (add `--routes /,/haiku` to limit to affected pages; `--base-url`
   to target a non-default server). Full-page desktop + tablet + mobile PNGs
   land in `ui/e2e/screenshots/`, and the script asserts no horizontal
   overflow at each captured width plus a few assert-only widths (exits
   non-zero, naming the widest element, if a page overflows). Admin pages
   (lists, editors, image cleanup) are captured too when
   `E2E_AUTH0_USERNAME` / `E2E_AUTH0_PASSWORD` are set (as they are in CI);
   without them the script captures the public pages only and says so.
2. Actually LOOK at each screenshot (Read the PNG files) and check for:
   content overflowing its container, clipped/squashed/stretched images,
   text that is hard to read against its actual rendered background,
   overlapping elements, and broken layout at the 390px mobile width.
3. Fix what you find and re-capture until the pages look right. Mention in
   the PR that the visual check was done and what it covered.

CI runs the same check on PRs touching `ui/**`
(`.github/workflows/visual-review.yml`): it captures the same screenshots
against the seeded e2e stack and Claude reviews them, posting an advisory
sticky PR comment (needs the `CLAUDE_CODE_OAUTH_TOKEN` repo secret, from
`claude setup-token` — usage draws from the Claude Pro/Max subscription,
deliberately never API credits; skips with a notice when absent). Advisory
means treat findings as a reviewer's notes —
address or create github issues for them, but the job never blocks a merge.

Admin UI changes also have a design brief, `docs/ui-design-brief.md`:
the admin should feel friendly and welcoming to its one non-technical
user, and every change to what it shows (components, copy, empty/error/
success states, dialogs) is judged against that brief's checklist as
well as the visual check. Read it before starting such a change; the
visual check asks "does it look right", the brief asks "does it feel
right".

Admin-only changes without local credentials: when a change is confined to
components only the admin pages render (e.g. `tiptap.tsx`, reachable only
through the admin blog post editor) and you have no `E2E_AUTH0_*` env vars,
local capture cannot exercise what you changed. Still run it, but know its
purpose there is narrower: the horizontal-overflow assertions plus a
public-page regression baseline, nothing more. Don't over-invest in
studying public PNGs that cannot show your change — CI's visual review is
the authoritative appearance check for admin pages, and say so in the PR.
To reproduce a finding CI reported, download the exact images the reviewer
saw rather than recreating them locally:
`gh run download <run-id> -n visual-review-screenshots`. Issue #266
(compile-time-gated fake auth) is the real fix — it would let local capture
cover admin pages without Auth0 credentials.

## Working on GitHub Issues
- If a github issue doesn't exist yet for what you are working on, create one.
- Before starting work on an issue, add the `in progress` label and leave a
  comment naming your branch, so parallel sessions don't pick up the same
  issue. Skip issues already labeled `in progress`.
- Readiness labels: `has-dependencies` marks an issue that needs another
  open issue resolved first; `needs-clarification` / `blocked` mark issues
  waiting on a human. There is deliberately no positive "safe to work"
  label — whether two issues collide is a property of the pair and of
  what has merged since, so judge file overlap per batch (see Parallel
  Sessions below), never from a label.
- Put `Closes #N` in the PR body. From PR-open onward the issue-lifecycle
  workflow (`.github/workflows/issue-lifecycle.yml`) owns the label: it
  re-adds `in progress` on PR open and removes it when the PR merges or is
  closed without merging. Merging also auto-closes the issue (native GitHub
  behavior) — no manual label cleanup needed once a PR exists.
- Caveat: GitHub only creates closing references for PRs based on `main`, so
  for a stacked PR keep the label manual until the PR retargets to `main`
  (retargeting fires the workflow, which takes over from there).
- IMPORTANT: File new issues for what you find along the way instead of
  letting it evaporate or silently expanding the current PR's scope:
  - Any difficulty in the dev environment (broken or confusing scripts,
    flaky tooling, missing setup steps) — capture the problem and whatever
    workaround you used.
  - Natural next steps, unrelated problems noticed mid-task, and tech debt
    exposed by the work.
  - Issues with the current design, even things requiring a larger rewrite
    are good to capture and we can triage them later.

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
- Fresh worktree setup (do this first, it is not shared from the main
  clone): run `./scripts/setup-worktree.sh` before ANY UI command. It
  installs `ui/node_modules` (`npm ci`, up to a minute on a cold npm cache)
  and the Playwright chromium build the visual check needs. Without it,
  tests and lint die with `command not found`, and
  `node e2e/screenshots.mjs` with `ERR_MODULE_NOT_FOUND`, before any of them
  do real work. Re-running is cheap and safe: it skips `npm ci` when
  `ui/node_modules` already matches the lockfile, and Playwright's browsers
  live in a cache outside `node_modules` (`~/.cache/ms-playwright`), so that
  step is a quick no-op unless the machine is fresh or Playwright was
  bumped. Pass `--force` to reinstall dependencies regardless. Changing this
  script, or dev.sh's delegation to it? Re-run the tests:
  `bash scripts/setup-worktree-test.sh`.
- Commit only explicitly listed paths (`git add <paths>`, never `git add -A`
  in a shared tree); treat any file outside your issue's scope as owned by
  another session.
- Before pushing UI changes, run `npm run test:coverage`, not just
  `npm run test:run` — the CI coverage job enforces the ratchet floors and
  plain test runs won't catch a floor breach. Adding conditional logic can
  lower the branch percentage even when every test passes.
- `test:coverage` runs `npm run typecheck` first, so that covers the type
  check; add `npm run typecheck:e2e` yourself if you touched `e2e/`.
  Neither vitest (which transpiles without checking types) nor eslint (not
  type-aware here) sees type errors, so a bare `vitest run` + `lint` can be
  green while CI's build fails on something as small as an implicit-`any`
  callback parameter in a `*.test.tsx` — and that failure takes the e2e and
  screenshot jobs down with it, since their webServer builds the test
  bundle.
- Before pushing shell or workflow changes (`*.sh` anywhere in the repo,
  including `automation/`, and `.github/workflows/*`), run
  `./scripts/lint-workflows.sh` — see Test Commands above. It is the same
  script CI's `shell-lint` job runs, and it needs nothing installed.
- Undoing a temporary edit (a mutation-test tweak, a debug print): copy the
  file aside first (`cp f f.bak`, restore with `cp f.bak f`) or `git stash`
  / commit WIP. Never `git checkout -- <file>` or `git restore <file>` for
  this — those revert to the committed version, silently destroying every
  uncommitted change in the file, not just the one you meant to undo.
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
- keep things DRY (important)

## AWS Integration
- Deploys (`.github/workflows/deploy.yml`): every CI-green merge to `main`
  auto-deploys to the test environment (test.karidavidson.com); the prod
  deploy job then waits on the `production` GitHub Environment's required
  reviewer. Both bundles are built up front from the CI-validated commit, so
  approval promotes exactly what was reviewed on test. One-time
  infrastructure setup: `docs/test-deployment-setup.md`.
- Login: `aws sso login` before running API locally
- S3 sync: `./scripts/sync_s3_prod_to_test.sh` to sync production S3 to test
- Image GC: `POST /images/gc` (admin JWT) sweeps orphaned `images/` objects.
  Dry-run by default; pass `?dry_run=false` to actually delete. Objects
  modified within the last hour are always skipped (in-flight uploads), and
  any manifest fetch/parse failure aborts the sweep before anything is deleted.
  It classifies per IMAGE, not per object (below), so a whole prefix is kept,
  skipped or deleted together.
- Image storage layout: every uploaded image owns a key PREFIX, not one
  object — `images/<id>/original.<ext>` (the untouched upload) plus
  `images/<id>/thumb.jpg` (generated server-side at upload time; admin grids
  and previews render it). The id is still the `<uuid>.<ext>` name
  `POST /images` returns, so every stored reference (`backgroundPhoto`,
  `haiga.image`, ...) is unchanged and only URL construction knows about
  variants: the API takes `GET /images/<id>?size=thumb` (falling back to the
  original when a variant is missing), while the public site, reading S3
  directly, fetches the full path. `api/src/services/image_keys.rs` is the
  ONE place key shapes live — build keys there, never by string-formatting.
- Bucket migration: `migrate-images`, a subcommand of the API binary, copies
  legacy `images/<name>` objects into the new layout, backfills thumbnails
  and rewrites the S3 URLs in published blog HTML. Dry-run by default, and
  idempotent, so run it, deploy, then run it again to catch uploads in
  between. Run it from the REPO ROOT (not from `api/`):
  `BUCKET_NAME=test.karidavidson.com cargo run --manifest-path api/Cargo.toml
  -- migrate-images [--apply]`
  The working directory is load-bearing, for the same reason `scripts/dev.sh`
  starts the API from the root: `dotenv` searches the cwd and its ancestors,
  so from `api/` it loads `api/.env` and sets `AWS_ENDPOINT_URL` to the dev
  stack's MinIO, `AWS_REGION` to `us-east-1` and the `kari-e2e` static keys.
  Unsetting them on the command line does NOT help — `env -u` makes them
  unset, which is exactly the case `dotenv` fills in — so from `api/` the
  command refuses to run ("Refusing to run against the local endpoint"), and
  adding `--allow-local` to get past that migrates local MinIO while you
  believe you are migrating the real bucket. From the root there is no `.env`
  to find, so the SSO credential chain and profile region are in charge.
  `--allow-local` is only for a deliberate rehearsal against the dev stack
  (run it from `api/`, where `api/.env` supplies MinIO's endpoint and keys).
  The migration is copy-only — the legacy objects stay — but it is not
  optional before a deploy of the code that reads the new layout: the API
  falls back to the legacy key, yet the PUBLIC site reads S3 directly, and
  S3 has no fallback of its own. The UI therefore retries a failed public
  image at `images/<id>` (`fallBackToLegacyS3Image` in
  `image-management-helpers.ts`, wired into every public `<img>`, the
  injected blog HTML and the site-background hook), so an unmigrated bucket
  costs one wasted request per image rather than a broken page. Migrate
  anyway, promptly — the fallback is a safety net, not the intended path,
  and it retires with the legacy layout (#452).
  Don't press "Image cleanup" between migrating a bucket and
  deploying the code that understands it. Caveat for local rehearsals: MinIO
  is filesystem-backed and will not LIST `images/<id>/…` while an object
  exists at the exact key `images/<id>`, so a rehearsal there cannot exercise
  the both-layouts-coexist paths (real S3, which the deployed buckets are,
  lists both).
