# Testing and Coverage

Reference detail for this repo's test suites and the coverage ratchet.
CLAUDE.md carries the commands and the never-lower-a-floor rule; this file
is what you read before adding tests or when a coverage floor fails.

For the e2e stack's prerequisites, see `docs/local-development.md`.

## Vitest project layout

`npm run test:coverage` runs `npm run typecheck` first. That is deliberate:
`test:coverage` is the documented pre-push command for UI changes, so the
type check is mechanical rather than remembered. `npm run test` /
`test:run` stay typecheck-free to keep the inner loop fast.

The vitest suite is split into two projects (the `projects` block in
`ui/vitest.config.ts`; it lived in a separate `vitest.workspace.ts` until
vitest 4 removed workspace files, #529):

- `unit` (jsdom) — app code. Everything defaults here.
- `config` (node) — tests that assert on this package's own tooling. These
  go in `ui/test/config/`, with the CSS design invariants in
  `ui/test/design/`.

Coverage stays configured once in `ui/vitest.config.ts` and is measured
across both projects, over every workspace.

`npm run typecheck` type-checks app code, tests and the vite configs
(`tsc -b`; every project sets `noEmit`, so nothing is written). CI's
Frontend job runs it as its own step, so a type error is named rather than
buried in a build failure. `npm run typecheck:e2e` covers the Playwright
specs plus the plain-`.mjs` node scripts, which are a separate TS project.

## What CI runs

`.github/workflows/ci.yml` runs the lint, typecheck, test, build and
coverage commands from CLAUDE.md's list on each pull request, and a
`coverage` job posts a whole-codebase coverage comment on the PR (per-file
breakdown in the job summary). Coverage is measured over ALL source files,
not a curated subset — don't narrow the scope.

The dev-loop and AWS commands in that list are NOT run by CI (`dev.sh`,
`setup-worktree.sh`, `npm run dev`, `cargo watch`, `aws sso login`,
`sync_s3_prod_to_test.sh`), so a breakage there shows up locally or not
at all. Two near-misses worth knowing: `npm run preview` IS covered,
because the e2e job's Playwright `webServer` runs
`npm run build:test && npm run preview`; and `setup-worktree.sh` is
covered only by its test harness (`scripts/setup-worktree-test.sh`), not
by being run for real.

## The coverage ratchet

Thresholds are floors pinned just below current numbers:

- UI: `coverage.thresholds` in `ui/vitest.config.ts`
- API: `--fail-under-lines` in the coverage CI job

When coverage rises meaningfully, bump the floors in the same PR — never
lower them to make a PR pass.

The UI ratchet has two layers, and both are load-bearing: whole-run floors,
plus a group keyed by workspace glob — `apps/public/src/**`,
`apps/admin/src/**`, `packages/shared/src/**`. Vitest's glob groups do not
partition the run (it checks every glob's matches AND, separately, every
measured file against the top-level numbers), so the groups stop one
workspace's regression hiding behind another's headroom while the whole-run
floors stay the backstop for any file no glob names — a fourth workspace
would otherwise be policed by nothing.
`ui/test/config/coverage-thresholds.test.ts` pins that shape.

The PR coverage comment carries a row per workspace plus the total, which
is the number to bump a floor from — never a local one (#398).

When two open PRs both bump the floors, CLAUDE.md's Parallel Sessions
section has the rule for resolving the conflict.
