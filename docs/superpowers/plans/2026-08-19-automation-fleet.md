# Automation Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repo-configured framework for recurring autonomous agents (cron → dispatcher → headless Claude sessions), shipping with its first agent: the GitHub-issue pipeline.

**Architecture:** One cron entry calls `automation/dispatch.sh` every 15 minutes; it reads per-agent markdown files (YAML frontmatter config + prompt body) from `automation/agents/`, tracks last-run/locks/logs in a laptop-local state dir, and launches due agents headlessly from the repo root. The issue-pipeline agent is a stateless orchestrator playbook whose worker/fix/review subagent briefs live in `automation/templates/`.

**Tech Stack:** bash (dispatcher + tests), markdown prompt files, `gh` CLI, Claude Code headless (`claude -p`).

**Spec:** `docs/superpowers/specs/2026-08-19-automation-fleet-design.md`

## Global Constraints

- Repo defines what/how-often; machine state (last-run, locks, logs) lives in `~/.local/state/kari-website-automation` (env override `KARI_AUTOMATION_STATE_DIR`).
- Dispatcher must work under `set -euo pipefail` and pass `shellcheck`.
- Fleet kill switch: `automation/PAUSE` file (must be gitignored).
- Agents launch from the repo root so CLAUDE.md loads and subagents inherit it.
- Formatting: 2-space indent, 80-char lines; kebab-case filenames.
- No CI changes in this PR; shell tests run locally (`automation/dispatch-test.sh`).
- Cron entry is NOT installed by this plan (rollout step after supervised run).

---

### Task 1: Dispatcher tests (failing first)

**Files:**
- Create: `automation/dispatch-test.sh` (executable)

**Interfaces:**
- Consumes: `automation/dispatch.sh` CLI contract (Task 2 implements it):
  `dispatch.sh [--dry-run]`; env overrides `KARI_AUTOMATION_STATE_DIR`,
  `KARI_AUTOMATION_AGENTS_DIR`, `KARI_AUTOMATION_PAUSE_FILE`,
  `KARI_AUTOMATION_CLAUDE_BIN` (test stub instead of real `claude`).
- Produces: a test harness later contributors extend.

- [ ] **Step 1: Write the test script** — plain bash, temp dirs per test, an
  `expect_contains <haystack-file> <needle> <test-name>` helper, exit 1 on
  any failure. Cases (all via `--dry-run` except the stub-launch one):
  1. enabled agent, never run → output contains `WOULD RUN issue-pipeline`
  2. `enabled: false` → `skip demo-agent: disabled`
  3. last-run 60s ago with `every: 1h` → `not due`
  4. last-run 2h ago with `every: 1h` → `WOULD RUN`
  5. PAUSE file present → `paused`, and no `WOULD RUN` lines
  6. agent file missing `name`/`every` → `SKIP` warning, exit code still 0
  7. real run (no `--dry-run`) with `KARI_AUTOMATION_CLAUDE_BIN` pointing at
     a stub script that records its args + stdin → stub receives
     `--dangerously-skip-permissions`, `--model fable`, and the prompt body
     (frontmatter stripped); last-run file created; log file created
  8. second real run immediately after → `not due` (last-run recorded)
- [ ] **Step 2: Run it, verify it fails** — `bash automation/dispatch-test.sh`
  must fail with "dispatch.sh: not found" style errors, not syntax errors.
- [ ] **Step 3: Commit** — `git add automation/dispatch-test.sh && git commit`

### Task 2: Dispatcher

**Files:**
- Create: `automation/dispatch.sh` (executable)

**Interfaces:**
- Produces: the CLI contract in Task 1. Frontmatter keys read: `name`,
  `enabled`, `every` (`Nm|Nh|Nd`), `model` (optional).

- [ ] **Step 1: Implement** per spec §Dispatcher:
  - `set -euo pipefail`; resolve `REPO_ROOT` from script location.
  - PAUSE check → print `fleet paused` and exit 0.
  - `fm()` awk helper: first `key: value` between the first two `---` lines;
    `body()` awk helper: everything after the second `---`.
  - Per agent: skip+warn on missing `name`/`every`; skip disabled; compute
    due from `now - last-run >= interval`; `--dry-run` prints `WOULD RUN`.
  - Launch: background subshell holding `flock -n` on
    `$STATE_DIR/<name>.lock` (skip if held), record last-run at start,
    `cd "$REPO_ROOT"`, pipe body to
    `"$CLAUDE_BIN" -p --dangerously-skip-permissions ${model:+--model "$model"}`
    with stdout+stderr to `$STATE_DIR/logs/<name>-<timestamp>.log`; disown
    so the dispatcher exits without waiting.
  - Prune logs older than 30 days.
- [ ] **Step 2: Run tests to verify they pass** — `bash automation/dispatch-test.sh`
- [ ] **Step 3: shellcheck both scripts** — `shellcheck automation/dispatch.sh automation/dispatch-test.sh`, fix all findings
- [ ] **Step 4: Commit**

### Task 3: Subagent brief templates

**Files:**
- Create: `automation/templates/worker-brief.md`
- Create: `automation/templates/fix-brief.md`
- Create: `automation/templates/review-brief.md`

**Interfaces:**
- Consumes: nothing (pure prompt text with `{{PLACEHOLDER}}` slots).
- Produces: templates the issue-pipeline playbook (Task 4) references by
  path and fills in: worker gets `{{ISSUE_LIST}}`, `{{SLUG}}`, `{{MODEL_NOTE}}`;
  fix gets `{{PR_NUMBER}}`, `{{WORKTREE_PATH}}`, `{{FEEDBACK}}`; review gets
  `{{PR_NUMBER}}`.

- [ ] **Step 1: worker-brief.md** — must encode, verbatim from spec
  §Worker/fix/review briefs: sibling worktree `../kari-website-{{SLUG}}`
  branched from `origin/main` on branch `agent/{{SLUG}}`; explicit skill
  invocations (test-driven-development; systematic-debugging for bugs;
  verification-before-completion); full local gauntlet
  (`npm run test:coverage` never just `test:run`; `npm run lint`;
  clippy/fmt/`cargo test` for API changes); mandatory visual check via
  per-worktree `./scripts/dev.sh` + `node e2e/screenshots.mjs` for UI
  changes (public pages only without `E2E_AUTH0_*`; say so in the PR);
  PR with `Closes #N` + squash-worthy title; finish at PR-open, never wait
  on CI; structured final report (shipped / next steps / tech debt /
  problems hit); never touch files outside the issue's scope; never
  `git add -A`.
- [ ] **Step 2: fix-brief.md** — work only in `{{WORKTREE_PATH}}`; for each
  feedback item either fix it or dismiss it with a reasoned PR reply
  (`gh pr comment`); re-run the gauntlet relevant to what changed; push;
  report what was fixed vs dismissed and why.
- [ ] **Step 3: review-brief.md** — adversarial review of
  `gh pr diff {{PR_NUMBER}}`: correctness first, then test adequacy
  (including coverage-ratchet compliance), then repo conventions; must try
  to construct concrete failure scenarios, not style nits; verdict format:
  `CLEAN` or a numbered findings list with file:line and failure scenario.
- [ ] **Step 4: Commit**

### Task 4: Issue-pipeline agent definition

**Files:**
- Create: `automation/agents/issue-pipeline.md`

**Interfaces:**
- Consumes: templates by repo-relative path (Task 3).
- Produces: frontmatter contract for the dispatcher:
  `name: issue-pipeline`, `enabled: false` (flipped after supervised run),
  `every: 1h`, `model: fable`.

- [ ] **Step 1: Write frontmatter + playbook body** implementing spec
  §Issue-pipeline agent exactly: safety rails block first (only `agent/*`
  branches; never force-push; never checkout in the main clone; never touch
  prod; ≤3 workers; serial squash merges); Phase A (tend PRs: CI red → fix
  agent; unaddressed `visual-review` sticky comment → fix agent;
  green+settled+unreviewed → review agent, `agent:reviewed` label —
  create label if missing — only on CLEAN; serial merge + update remaining
  branches, re-measuring coverage floors on conflict); Phase B (capacity
  check; skip labels `in progress`, `has-dependencies`,
  `needs-clarification`, `idea`, `blocked`; underspecified →
  comment + `needs-clarification`; overlap → combine into one branch;
  claim via label+comment; Opus for straightforward, Fable for
  complex; spawn via Agent tool with worker briefs); Phase C (file issues
  from reports; print run summary).
- [ ] **Step 2: Consistency check** — every label, branch prefix, template
  path, and cap in the playbook matches spec + templates. Frontmatter
  parses with the dispatcher: `KARI_AUTOMATION_AGENTS_DIR=automation/agents
  automation/dispatch.sh --dry-run` shows the agent as disabled-skip.
- [ ] **Step 3: Commit**

### Task 5: README, .gitignore, finish branch

**Files:**
- Create: `automation/README.md`
- Modify: `.gitignore` (append `automation/PAUSE`)

- [ ] **Step 1: README** — what the fleet is, one-paragraph dispatcher
  description, how to add an agent (file format + frontmatter keys), state
  dir layout, PAUSE/enabled kill switches, the cron line to install
  (`*/15 * * * * /home/adamd/Projects/kari-website/automation/dispatch.sh`),
  and the rollout status (cron not yet installed; issue-pipeline
  `enabled: false` until the supervised run passes).
- [ ] **Step 2: .gitignore entry; verify** `git check-ignore automation/PAUSE`
- [ ] **Step 3: Full verification** — dispatch-test.sh green; shellcheck
  clean; dry-run against the real `automation/agents/` dir behaves.
- [ ] **Step 4: Commit, then use superpowers:finishing-a-development-branch**
  to open the PR (title works as squash subject; body notes: no UI changes
  so no visual check needed; shell tests are local-only by design).

### Task 6: File the shakedown issue

**Files:** none (GitHub issue only)

- [ ] **Step 1: `gh issue create`** — title "Staging-only page: what's on
  test but not yet promoted to prod". Body: full spec from design doc
  §"What's on test" page (staging-build flag gate; client-side fetch of
  latest successful `production` environment deployment SHA from the
  public GitHub API; compare to `VITE_COMMIT_SHA` baked in by a new env
  line in `deploy.yml`'s build job for both builds; list squash-merge PR
  titles/links in between; empty state "test == prod"; unauthenticated
  API OK, repo public, 60 req/hr limit fine). Label `parallel-safe`.
  Note in the body that this is the automation pipeline's shakedown task.
