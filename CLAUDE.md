# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

It holds the standing rules — what applies whatever you are touching. The
reference detail behind them lives in `docs/`, reached from a trigger line
in the rule that needs it. When a trigger matches what you are about to do,
READ that doc first; never work from a guess at what it probably says.

## Commands

UI commands run from `ui/`, cargo commands from `api/` (the one exception,
`migrate-images`, runs from the repo root — see `docs/image-storage.md`).

UI:
- `npm run dev` / `npm run dev:admin` — public / admin dev server
- `npm run build` / `npm run build:test` — production / test-env build
  (both apps into one `ui/dist`)
- `npm run preview` — serve a built `ui/dist` on 4173
- `npm run lint` — eslint
- `npm run typecheck` — app code, tests and vite configs;
  `npm run typecheck:e2e` — Playwright specs and `.mjs` node scripts
- `npm run test` / `npm run test:run` — vitest, watch / once
- `npm run test:coverage` — typecheck, then vitest with coverage
- `npm run test:e2e` — Playwright e2e against a local seeded stack

API:
- `cargo watch -x 'run dev'` — run in watch mode; `cargo build`
- `cargo test` — integration tests
- `cargo clippy --all-targets -- -D warnings` — CI enforces no warnings
- `cargo fmt --check`
- `cargo llvm-cov --summary-only` — coverage (needs cargo-llvm-cov)

Repo:
- `./scripts/setup-worktree.sh` — fresh-worktree setup (UI dependencies +
  the Playwright browser the visual check needs). Idempotent and cheap to
  re-run.
- `./scripts/dev.sh` — the whole dev stack (MinIO + seed + API + both UI
  dev servers). `--aws` targets the real test bucket via SSO.
- `./scripts/lint-workflows.sh` — actionlint + shellcheck over `.github/`
  and every `*.sh` in the repo
- `aws sso login` — before running the API against AWS
- `./scripts/sync_s3_prod_to_test.sh` — sync production S3 to test

CI (`.github/workflows/ci.yml`) runs every one of these on each pull
request, plus a `coverage` job that posts a coverage comment.

## Read the doc before you start

Each line below is a trigger. If you are about to do the thing on the
left, read the doc on the right FIRST — the rules in this file are
deliberately short, and the doc holds the part that bites.

- Starting a dev stack, running `test:e2e` locally, logging into the
  local admin app, working in a fresh worktree, or touching
  `ui/scripts/serve.mjs` (it mirrors the deployed nginx vhost by hand) →
  `docs/local-development.md`
- Adding or changing tests, or a coverage floor has failed →
  `docs/testing.md`
- Changing any `*.sh` (anywhere, including `automation/`) or any
  `.github/workflows/*` → `docs/linting.md`, and run
  `./scripts/lint-workflows.sh` before pushing
- Adding, removing or upgrading a dependency by hand, editing
  `renovate.json`, or `npm ci` warned or failed to resolve →
  `docs/dependency-management.md`
- Touching image upload, storage or GC code, or running a bucket
  migration → `docs/image-storage.md`
- Capturing screenshots for an admin-only change, or reproducing
  something CI's visual review reported → `docs/visual-checks.md`
- Changing anything the `/admin` pages show (components, copy,
  empty/error/success states, dialogs) → `docs/ui-design-brief.md`
- Setting up deployment infrastructure (one-time) →
  `docs/test-deployment-setup.md`

## UI Layout (npm workspaces)

`ui/` is an npm workspace root with three workspaces (#591). One
`ui/package-lock.json`, one `npm ci`, one `node_modules` — every command
above still runs from `ui/`.

- `ui/apps/public` — the public site, served from `/`, built into
  `ui/dist`. It contains NO Auth0, tiptap or admin code; the header's
  "Admin" entry is a plain `<a href="/admin">` that leaves the SPA.
- `ui/apps/admin` — the admin app, served under `/admin`, built into
  `ui/dist/admin` (vite `base: "/admin/"`, router `basename: "/admin"`).
  Routes inside it are written as if it owned the site root — `/haiku`,
  not `/admin/haiku` — and react-router adds the prefix on the way out.
- `ui/packages/shared` (`@kari/shared`) — `models.ts`, the API-facing
  services, the shared utils/hooks, the components both sides render, and
  the global stylesheets + background assets. It is consumed as TypeScript
  SOURCE through its `exports` map (no build step), so vite, vitest and
  `tsc` all read `packages/shared/src/*` directly.
- `ui/test` — the cross-workspace tests: tooling assertions
  (`test/config/`, node environment) and the CSS design invariants
  (`test/design/`), which read stylesheets from BOTH apps and so cannot
  live in either.

npm hoists every workspace's dependencies into one `node_modules`, so an
admin-only import from public code would still resolve and ship.
`ui/test/config/app-boundaries.test.ts` is what actually enforces the
split — keep it passing rather than working around it.

## Coverage Is a Ratchet

Coverage thresholds are floors pinned just below current numbers (UI:
`coverage.thresholds` in `ui/vitest.config.ts`; API: `--fail-under-lines`
in the coverage CI job). When coverage rises meaningfully, bump the floors
in the same PR — NEVER lower them to make a PR pass. Bump from the PR
coverage comment's numbers, never a local run (#398). Coverage is measured
over ALL source files, not a curated subset — don't narrow the scope.

`docs/testing.md` has the mechanics: the two ratchet layers, the vitest
project split, and what to do when two open PRs both bump the floors.

## Visual Checks (required for UI changes)

Tests assert behavior, not appearance — features have shipped green while
an image overflowed its card or text was illegible against the background.
So after ANY change that can affect how the UI looks (components, CSS,
layout, `index.html`, UI dependency bumps), before claiming the work is
done or opening a PR:

1. With the dev stack running (`./scripts/dev.sh`), run
   `node e2e/screenshots.mjs` from `ui/`. In a fresh worktree run
   `./scripts/setup-worktree.sh` first or the capture script fails. PNGs
   land in `ui/e2e/screenshots/`; the script also fails on horizontal
   overflow, naming the widest element.
2. Actually LOOK at each screenshot (Read the PNG files) and check for:
   content overflowing its container, clipped/squashed/stretched images,
   text that is hard to read against its actual rendered background,
   overlapping elements, and broken layout at the 390px mobile width.
3. Fix what you find and re-capture until the pages look right. Mention in
   the PR that the visual check was done and what it covered.

CI runs the same capture on PRs touching `ui/**` and Claude reviews the
images, posting an advisory PR comment — treat its findings as a
reviewer's notes: address them or file issues, but the job never blocks a
merge.

`docs/visual-checks.md` covers the rest: script flags, what CI's review
job needs, how to download the exact images it saw, and how much local
capture is worth when the change is admin-only and you have no
`E2E_AUTH0_*` credentials (read it before deciding to skip a capture).

Admin UI changes also have a design brief, `docs/ui-design-brief.md`: the
admin should feel friendly and welcoming to its one non-technical user,
and every change to what it shows is judged against that brief's checklist
as well as the visual check. Read it before starting such a change; the
visual check asks "does it look right", the brief asks "does it feel
right".

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
  Sessions below), never from a label. `bug` is a priority claim the
  pipeline works ahead of everything else — apply it only when
  something is broken or blocked for a visitor or the admin (a broken
  flow, an unusable control, unreadable content), never to visual
  polish or design-brief near-misses; the backlog-grooming agent
  audits it.
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
- Run `./scripts/setup-worktree.sh` in a fresh worktree before ANY UI
  command — nothing installable is shared from the main clone, so without
  it tests, lint and the screenshot script all die before doing real work.
  Details in `docs/local-development.md`.
- Commit only explicitly listed paths (`git add <paths>`, never `git add -A`
  in a shared tree); treat any file outside your issue's scope as owned by
  another session.
- Before pushing UI changes, run `npm run test:coverage`, not just
  `npm run test:run` — the CI coverage job enforces the ratchet floors and
  plain test runs won't catch a floor breach. Adding conditional logic can
  lower the branch percentage even when every test passes.
- `test:coverage` runs `npm run typecheck` first, so that covers the type
  check; add `npm run typecheck:e2e` yourself if you touched `e2e/`.
  Neither vitest nor eslint sees type errors here, so a bare `vitest run`
  + `lint` can be green while CI's build fails — and that failure takes
  the e2e and screenshot jobs down with it.
- Before pushing shell or workflow changes (`*.sh` anywhere in the repo,
  including `automation/`, and `.github/workflows/*`), run
  `./scripts/lint-workflows.sh` — the same script CI's `shell-lint` job
  runs, needing nothing installed.
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

## Process
The superpowers plugin is deliberately disabled for this repo
(`.claude/settings.json` commits the `false` override — don't remove it;
current models don't need its enforcement scaffolding and every fleet
tick was paying for it, #540). The substance it enforced still applies,
harness-free:
- Clarify intent before building: for non-trivial features, agree on
  design and scope first — interactively, ask; in the pipeline, the
  issue plus its planning pass is the spec, so never guess at product
  decisions.
- Plan multi-step work before touching code.
- Test-first for behavior changes; debug from root cause rather than
  tweaking until green; claim something works only after running the
  verifying command and reading its output.

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

## Deploys
Every CI-green merge to `main` auto-deploys to the test environment
(test.karidavidson.com) via `.github/workflows/deploy.yml`; the prod deploy
job then waits on the `production` GitHub Environment's required reviewer.
Both bundles are built up front from the CI-validated commit, so approval
promotes exactly what was reviewed on test. One-time infrastructure setup:
`docs/test-deployment-setup.md`.
