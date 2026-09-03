# Workflow and Shell Linting

Reference detail for `./scripts/lint-workflows.sh`. CLAUDE.md carries the
rule (run it before pushing any change to a `*.sh` file or to
`.github/workflows/*`); this file is what you read when you are changing
one of those files or when a local run disagrees with CI.

## What it checks

`./scripts/lint-workflows.sh` runs four checks:

1. actionlint over `.github/` — schema, action inputs, `${{ }}`
   expressions, and shellcheck over every embedded `run:` script.
2. Every job sets a job-level `timeout-minutes`.
3. shellcheck over every `*.sh` in the repo.
4. Every pinned docker image in those scripts carries the
   `# renovate: datasource=docker` comment that `renovate.json`'s
   customManager keys off (without it the pin is invisible to Renovate).

Nothing to install — actionlint, shellcheck and yq each fall back to a
pinned docker image when the binary is missing, so there is never a reason
to hand-roll a `docker run koalaman/shellcheck` of your own.

This is the script CI's `shell-lint` job runs.

## `--images`, and why a local run can disagree with CI

CI runs it as `--images`, which ignores installed binaries and uses the
pins for every tool. An installed shellcheck is whatever release the
machine has, and releases disagree about real findings: 0.9 reds a trap
handler as SC2317 that the pinned 0.11 reports as SC2329.

So if a local run disagrees with CI, re-run with `--images` (or
`KARI_LINT_FORCE_IMAGES=1`) — that, not your `shellcheck --version`, is the
definition of clean.

## The shell test harnesses

CI's `shell-lint` job also runs the shell test harnesses
`automation/dispatch-test.sh`, `scripts/setup-worktree-test.sh` and
`scripts/lint-workflows-test.sh`.

Changing the lint script? Re-run its tests:
`bash scripts/lint-workflows-test.sh` (needs jq plus either python3 +
PyYAML or a real mikefarah yq, whichever the machine has).
