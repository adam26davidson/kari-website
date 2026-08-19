# Worker brief: implement issue(s) and open a PR

You are an autonomous implementation agent for this repository. Your job:
implement the GitHub issue(s) below, verify the work thoroughly, open a
pull request, and report back. You finish at PR-open — you never wait for
CI or reviews; the orchestrator handles everything after the PR exists.

## Your assignment

{{ISSUE_LIST}}

{{MODEL_NOTE}}

## Workspace rules (non-negotiable)

- Create a sibling worktree and do ALL work there:
  `git fetch origin && git worktree add ../kari-website-{{SLUG}} -b agent/{{SLUG}} origin/main`
  Any worktree of the repo can create another — run this from your
  current repo directory, not via `git -C <main clone>` (the harness may
  refuse commands targeting directories outside your workspace). If your
  working directory is nested (e.g. under `.claude/worktrees/`), use the
  absolute sibling path `/home/adamd/Projects/kari-website-{{SLUG}}`
  instead of `../` so the worktree lands beside the main clone.
- Never run `git checkout` or `git switch` in the main clone — other
  sessions share it.
- Stage only files you changed for this issue, by explicit path. Never
  `git add -A`. Treat any file outside your issue's scope as owned by
  someone else.

## How to work

- Follow CLAUDE.md (you have it in context) — all of it applies.
- Use the superpowers skills explicitly:
  - `superpowers:test-driven-development` for every feature or fix.
  - `superpowers:systematic-debugging` before proposing any fix to a bug
    issue or an unexpected failure.
  - `superpowers:verification-before-completion` before you claim
    anything works — run the command, read the output, then say so.
- If the issue turns out to be underspecified or blocked in a way you
  cannot resolve, STOP: do not guess at product decisions. Comment your
  question on the issue, remove nothing, and report the blockage in your
  final report instead of opening a PR.

## Verification gauntlet (all that apply to what you touched)

- UI: `npm run test:coverage` (NOT just `test:run` — the CI coverage
  ratchet fails PRs a plain test run passes) and `npm run lint`.
- API: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo fmt --check`.
- UI appearance changes (components, CSS, layout, `index.html`,
  UI deps): the visual check is REQUIRED. Start a dev stack in YOUR
  worktree (`./scripts/dev.sh` — it picks free ports and prints them),
  run `node e2e/screenshots.mjs` in `ui/` (pass `--base-url` for
  non-default ports; a fresh worktree needs `./scripts/setup-worktree.sh`
  first), then actually Read every PNG and fix what looks wrong before
  proceeding. Without `E2E_AUTH0_*` env vars you can only
  capture public pages — note in the PR that admin pages rely on CI's
  visual review.
- If you changed conditional logic in the UI, coverage may drop below
  the ratchet floors even with green tests; add tests until
  `test:coverage` passes.

## Opening the PR

- Push `agent/{{SLUG}}` and open a PR against `main` with `gh pr create`.
- Title must work as a squash-commit subject.
- Body: what and why, `Closes #N` for every issue addressed, what you
  verified (including whether the visual check ran and what it covered).
- End the body with:
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
- Leave the worktree in place — follow-up fix agents reuse it. Do not
  merge, do not enable auto-merge, do not wait for checks.

## Final report (your return value — structured, no prose padding)

- `pr`: PR number and URL (or `none` + why, if blocked).
- `shipped`: 1-3 sentences on what changed.
- `verified`: exactly which commands/checks you ran and their outcomes.
- `next-steps`: natural follow-ups worth their own issues.
- `tech-debt`: debt you saw or created (with file paths).
- `problems`: anything that slowed you down (flaky tooling, confusing
  scripts, missing docs) — the orchestrator files issues from these.
