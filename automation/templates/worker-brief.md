# Worker brief: implement issue(s) and open a PR

You are an autonomous implementation agent for this repository. Your job:
implement the GitHub issue(s) below, verify the work thoroughly, open a
pull request, and report back. You finish at PR-open — you never wait for
CI or reviews; the orchestrator handles everything after the PR exists.

## Your assignment

{{ISSUE_LIST}}

{{MODEL_NOTE}}

## Implementation plan

{{PLAN}}

If a plan is present, it came from a dedicated planning pass: follow its
approach, file list, and test list rather than redesigning from scratch.
Deviate only where the code contradicts the plan — then note the
deviation and why in the PR body. If the plan says `None`, the issue is
scoped enough to plan yourself.

## Workspace rules (non-negotiable)

- Create a sibling worktree and do ALL work there:
  `git fetch origin && git worktree add ../kari-website-{{SLUG}} -b agent/{{SLUG}} origin/main`
  If your assignment names a kept `agent/{{SLUG}}` branch from a
  released claim, start from it instead (`git fetch origin &&
  git worktree add ../kari-website-{{SLUG}} agent/{{SLUG}}`) and review
  what it contains before building on it — it is unverified.
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

## Before you implement: check the issue's premise

- Issues age between filing and pickup. Before changing anything,
  re-verify the factual claims the issue rests on against the CURRENT
  tree: named file paths (`git ls-files <path>` — files move), quoted
  coverage numbers (re-measure), reproduction steps (reproduce). Note any
  discrepancy in the PR body. For a coverage-driven issue whose target
  already meets the bar, or a bug that no longer reproduces, do not
  implement: comment the fresh measurement on the issue, close it, and
  report that instead of a PR.
- Security / dependency-bump issues: version pins and advisory lists in
  the issue text are a starting hypothesis, not the spec — newer
  advisories may have landed since filing and the suggested version may
  itself be vulnerable by now. Re-derive the fix version at execution
  time from the live data (`npm audit` / `cargo audit` / the GitHub
  advisory), and verify the resolved tree clears ALL open advisories for
  the package, not just the one that prompted the issue. Say in the PR
  body which advisories the final versions clear.

## How to work

- Follow CLAUDE.md (you have it in context) — all of it applies.
- Keep your work off this machine: commit and push work-in-progress to
  `agent/{{SLUG}}` (`git push -u origin agent/{{SLUG}}`) as soon as you
  have any change and at least every 45 minutes after that — before any
  long-running step (dependency install, e2e run, visual check) rather
  than after it. You live inside the orchestrator's process; if it is
  killed by a host suspend or a usage limit, so are you. Once every
  sign of life on your claim (an open PR, a write in your worktree, a
  commit, activity on the issues, a running process) has been silent
  for two hours, a later tick releases your claim and removes your
  worktree. It saves uncommitted changes as a patch (or a WIP commit)
  and keeps any `agent/{{SLUG}}` branch that has commits ahead of
  `main`, handing both to the next worker on this slug — but a pushed
  branch is the reliable record, and workers that kept everything local
  have lost hours of work. PRs are squash-merged, so WIP commit
  messages are fine.
- Combined assignments (several issues on this one branch): claim every
  issue up front if the orchestrator has not already — `in progress`
  label plus a comment naming `agent/{{SLUG}}` on each. If one item turns
  out to be contentious or larger than it looked, drop it rather than
  stall the rest: leave its files untouched, remove its `in progress`
  label, comment on it why, and omit its `Closes #N` from the PR body;
  say so in the PR body and your report. The remaining items still ship.
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

- NEVER `npm run test` — that is vitest in watch mode: it never exits,
  and its long-lived workers grow on every rerun until they hit V8's
  heap cap (a worker doing this OOMed the host on 2026-08-21, #415).
  Use `npm run test:run` for a quick pass and `test:coverage` before
  pushing. The same goes for any other watch/serve command you are not
  going to stop yourself.
- UI: `npm run test:coverage` (NOT just `test:run` — the CI coverage
  ratchet fails PRs a plain test run passes, and `test:coverage` is also
  what runs `npm run typecheck`, which `test:run` does not) and
  `npm run lint`. Add `npm run typecheck:e2e` if you touched `e2e/`.
- API: `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `cargo fmt --check`.
- Shell or workflow changes (any `*.sh`, including `automation/`, and
  `.github/workflows/*`): `./scripts/lint-workflows.sh`. It is exactly what
  CI's `shell-lint` job runs — actionlint over the workflows, the
  job-level `timeout-minutes` assertion, shellcheck over every `*.sh` in
  the repo, and the renovate annotation on every pinned docker image — and
  it needs nothing installed, falling back to pinned docker images when a
  tool is missing from PATH. Don't hand-roll a `docker run
  koalaman/shellcheck` instead. CI passes `--images`, which uses the pins
  for every tool instead of whatever the runner has installed; add the
  flag locally if your run and CI disagree. If you touched the dispatcher, the
  worktree setup script or the lint itself, run the matching harness too —
  the same CI job runs `bash automation/dispatch-test.sh`,
  `bash scripts/setup-worktree-test.sh` and
  `bash scripts/lint-workflows-test.sh`.
- UI appearance changes (components, CSS, layout, `index.html`,
  UI deps): the visual check is REQUIRED. Start a dev stack in YOUR
  worktree (`./scripts/dev.sh` — it picks free ports and prints them),
  run `node e2e/screenshots.mjs` in `ui/` (pass `--base-url` for
  non-default ports; a fresh worktree needs `./scripts/setup-worktree.sh`
  first), then actually Read every PNG and fix what looks wrong before
  proceeding. Stop the stack when you are done with it (SIGTERM the
  `dev.sh` process you started — its trap tears down the API, vite and
  the MinIO container); the dispatcher reaps whatever survives your
  session, but a stack left running wastes RAM for the rest of it. Without `E2E_AUTH0_*` env vars you can only
  capture public pages — note in the PR that admin pages rely on CI's
  visual review, and see CLAUDE.md's Visual Checks section for how much
  local capture is worth when the change is admin-only.
- Admin UI changes (anything that changes what `/admin` shows,
  including copy and empty/error/success states): read
  `docs/ui-design-brief.md` first and self-check against its reviewer
  checklist before opening the PR. The reviewer applies the same list.
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
- Immediately after opening the PR, mark it pipeline-owned:
  `gh pr edit <n> --add-label agent-pr`. If the label doesn't exist
  yet, create it first:
  `gh label create agent-pr --description "Opened by the automation
  pipeline; the pipeline may review and merge it" --color 1D76DB`.
  The orchestrator only shepherds and merges PRs carrying this label —
  without it your PR sits unowned until a human intervenes.
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
- In all three, say explicitly when an item is about the machinery
  rather than about the website: the dispatcher, these briefs, the
  playbooks under `automation/`, claim/worktree handling, CI and the
  workflows, the lint scripts, the dev scripts and dev environment, the
  test harnesses. The orchestrator files those with the `tooling`
  label, which is how machinery work gets triaged together and how the
  pipeline leans towards product work when the machinery is smooth.
  (Everything it files also gets `automation`, which only records that
  the pipeline filed it.)
