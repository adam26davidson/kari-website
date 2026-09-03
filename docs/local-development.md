# Local Development

Reference detail for running this repo locally. CLAUDE.md carries the
command list and the standing rules; this file is what you read before
starting a dev stack, running `test:e2e` locally, or working in a fresh
worktree.

## Fresh worktree setup

Nothing installable is shared from the main clone, so run
`./scripts/setup-worktree.sh` before ANY UI command in a new worktree. It
installs `ui/node_modules` (`npm ci`, up to a minute on a cold npm cache)
and the Playwright chromium build the visual check needs. Without it,
tests and lint die with `command not found`, and `node e2e/screenshots.mjs`
with `ERR_MODULE_NOT_FOUND`, before any of them do real work.

Re-running is cheap and safe: it skips `npm ci` when `ui/node_modules`
already matches the lockfile, and Playwright's browsers live in a cache
outside `node_modules` (`~/.cache/ms-playwright`), so that step is a quick
no-op unless the machine is fresh or Playwright was bumped. Pass `--force`
to reinstall dependencies regardless.

Changing this script, or `dev.sh`'s delegation to it? Re-run the tests:
`bash scripts/setup-worktree-test.sh`.

## The dev stack (`./scripts/dev.sh`)

`./scripts/dev.sh` starts MinIO, seeds it, starts the API, and starts both
UI dev servers (public and admin). `--aws` targets the real test bucket
via SSO instead of local MinIO.

It runs `setup-worktree.sh` first, so a stack always starts against
lockfile-matching dependencies; that script's skip check keeps a warm start
cheap.

Stacks are per-worktree: compose's directory-based project naming keeps
each worktree's MinIO container separate, and dev.sh uses the default ports
(MinIO 9000, API 3000) when free but picks free ports otherwise (override
with `KARI_MINIO_PORT` / `KARI_API_PORT`; `KARI_MINIO_PORT=0` means
ephemeral). It prints the chosen URLs at startup and wires them into the
UI/API via env vars, so N stacks can run in parallel and `docker compose
down` in one worktree never touches another's stack.

## Dev servers

- `npm run dev` starts the PUBLIC site's dev server. Like the rest of the
  local toolchain it targets the local MinIO + localhost:3000 API from
  `.env.development`; the real AWS test bucket is opt-in via
  `./scripts/dev.sh --aws` — no vite mode silently reads AWS.
- `npm run dev:admin` starts the ADMIN app's dev server on its own port
  (5174 by default, so two vites can run side by side). It is a separate
  app, so plain `npm run dev` does not start it — `dev.sh` does, alongside
  the public one.

### Auth0 callbacks and the admin port

The admin app's Auth0 callback is `<origin>/admin`, so logging in locally
needs the port it comes up on allowlisted in the Auth0 application. The
default 5174 IS allowlisted (#633: callback `http://localhost:5174/admin`,
logout URL and web origin `http://localhost:5174`), so a stack on the
default port completes a real login round-trip — local admin verification
works, don't skip it. A parallel stack that vite bumps to 5175 is NOT, and
fails there with a callback mismatch until someone adds that origin too
(#630). A fixed default port is what makes that one-time allowlisting
possible at all.

## `npm run preview`

`npm run preview` serves a built `ui/dist` on 4173. NOT `vite preview`:
`ui/scripts/serve.mjs` stands in for it because the merged dist needs two
SPA fallback documents (`/admin*` gets the admin one). It is the permanent
local mirror of the deployed nginx vhost's fallback rule, not a stopgap —
running real nginx would make docker a prerequisite of `preview`,
`test:e2e` and the visual-review job without testing the actual
(out-of-repo, hand-maintained) vhost. The two are kept in step by hand:
change the rule in `serve.mjs` and the vhost needs the matching change.

## e2e prerequisites

`npm run test:e2e` seeds a local S3, builds the test-mode bundle, previews
it, and runs smoke + visitor journeys; admin journeys additionally run when
`E2E_AUTH0_USERNAME` / `E2E_AUTH0_PASSWORD` are set, as they are in CI. The
stack is fully local and hermetic — no AWS account or shared bucket.

Two things must be running:

1. a throwaway MinIO standing in for S3, on host port 9000 (the default):
   `docker compose up -d --wait minio` (defined in `docker-compose.yml`)
2. the API on localhost:3000: `cargo run` in `api/` (its `.env` already
   targets the local MinIO; run `node e2e/seed.mjs` in `ui/` first so the
   bucket exists for the API's health probe)

A dev stack started by `./scripts/dev.sh` satisfies both prerequisites when
it got the default ports (it prints which ports it chose). Against a stack
on non-default ports, export `VITE_S3_URL` / `VITE_API_URL` when running
`test:e2e` — env vars override `.env.test` for the seeds, specs, and the
built bundle alike.

CI starts both itself; `ui/e2e/seed.mjs` (re-run on every `test:e2e`) seeds
deterministic fixture content, so results never depend on what happens to
be in a real bucket.
