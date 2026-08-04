# Issue ↔ PR lifecycle automation — design

Date: 2026-08-04 · Issue: #29 · Approved in-session by Adam

## Goal

Make the `in progress` issue label self-maintaining once a PR exists, and
codify the linking convention, so parallel Claude Code sessions (and humans)
never pick up an issue someone is already working on and never have to clean
up labels by hand.

## What is native vs. built

- **Native GitHub (no code):** a merged PR whose body contains `Closes #N`
  auto-closes issue #N when it lands on the default branch.
- **Built here:** `.github/workflows/issue-lifecycle.yml` — syncs the
  `in progress` label with the lifecycle of PRs that close the issue.

## Workflow behavior

- Trigger: `pull_request`, types `[opened, reopened, edited, closed]`
  (`edited` catches `Closes #N` added to the body after opening).
- Permissions: `issues: write`, `pull-requests: read`.
- One `actions/github-script` step:
  - Queries the PR's `closingIssuesReferences` via GraphQL — the exact set
    GitHub will auto-close, so no regex parsing of the body.
  - `opened` / `reopened` / `edited` → add `in progress` to each linked issue.
  - `closed` (merged **or** abandoned) → remove `in progress` from each
    linked issue (404 on removal is swallowed: already-absent is fine).
- All operations are idempotent; PRs with no linked issues (e.g. Renovate)
  are a no-op.

## Convention (CLAUDE.md)

1. When claiming an issue: add `in progress` + comment naming your branch
   (manual — no PR exists yet). Skip issues already labeled.
2. Put `Closes #N` in the PR body. From PR-open onward the workflow owns the
   label; merging auto-closes the issue natively.

## Out of scope (YAGNI)

- Removing the label from an issue whose `Closes #N` reference is *edited
  out* of a still-open PR body.
- A `/claim` comment trigger for labeling before a PR exists.
- Fork PRs (repo has none; same-repo PRs only).

## Default-branch caveat (found during verification)

GitHub only creates `closingIssuesReferences` for PRs whose base is the
default branch — confirmed live: PR #28 (base `main`, "Closes #27") links
#27; PR #30 (base = stacked feature branch, "Closes #29") links nothing.
The workflow therefore no-ops on stacked PRs, which is *consistent*: native
auto-close would not fire for them either. It self-heals — when the base PR
merges, GitHub retargets the stacked PR to `main`, which fires this
workflow's `edited` trigger and the label is added then. Until that point
the label stays manual (documented in CLAUDE.md).

## Verification

GitHub Actions workflows are not unit-testable by the repo's suites; this is
config, verified by live exercise with a throwaway PR based on `main`
(carrying only the workflow file) that says `Closes #<throwaway issue>`:
PR-open must auto-add the label, close-without-merge must remove it. The
stacked PR #30 additionally verifies the retarget path when #28 merges.

## Branch/PR structure

Stacked on `worktree-issue-27-service-cleanups` (PR #28) because both PRs
edit the same new CLAUDE.md section; basing on main would guarantee a
conflict. The stacked PR retargets to main when #28 merges.
