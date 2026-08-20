# Automation fleet: repo-configured recurring agents (design)

Date: 2026-08-19
Status: approved (brainstormed and approved in-session)

## Goal

A small framework for running recurring, autonomous Claude Code agents on
the maintainer's laptop, with every agent's prompt and configuration
versioned in this repo. Agent #1 is an **issue pipeline**: it wakes on an
interval, picks ready GitHub issues, implements them in parallel via
subagents, shepherds the resulting PRs through CI / visual review / an
automated code review, and merges them serially into `main` (which
auto-deploys to test). Future agents (e.g. trend scouts that research and
file idea issues) are added by committing one file — no framework changes.

## Non-goals (now)

- Scout/research agents — future work. The framework must make adding them
  a one-file commit, but none ship in this iteration.
- An `idea`-label triage valve for scout-filed issues — future work,
  designed (pipeline will skip `idea`-labeled issues) but the label and
  triage flow land with the first scout.
- Prod deploys. Untouched: prod promotion stays gated on the human
  reviewer of the `production` GitHub Environment.

## Architecture

```
cron (one entry, every 15 min)
  └─ automation/dispatch.sh          # the only thing cron calls
       ├─ reads automation/agents/*.md (frontmatter: enabled, every, model)
       ├─ per-agent flock + last-run state in ~/.local/state/kari-website-automation/
       └─ for each due agent: headless `claude -p` from the repo root
            └─ issue-pipeline agent (orchestrator)
                 ├─ tends existing agent PRs (fix agents, review agent)
                 ├─ merges ready PRs serially
                 └─ spawns ≤1 issue worker (opus or fable)
```

### Agent definition format

One markdown file per agent in `automation/agents/`: YAML frontmatter for
config, body is the prompt.

```markdown
---
name: issue-pipeline
enabled: true
every: 1h        # m/h/d intervals, not cron syntax
model: fable     # model for the orchestrator session itself
---
<prompt / playbook>
```

### Dispatcher (`automation/dispatch.sh`)

- Installed as a single cron entry running every 15 minutes.
- Repo defines *what and how often*; the machine tracks *when last*:
  last-run timestamps, per-run logs, and lock files live in
  `~/.local/state/kari-website-automation/` (override: `KARI_AUTOMATION_STATE_DIR`).
- For each `automation/agents/*.md` that is `enabled: true` and whose
  `every` interval has elapsed since its last *started* run: launch
  `claude -p --model <model> --dangerously-skip-permissions` with the file's
  body as the prompt (stdin), from the repo root (so CLAUDE.md loads and
  subagents inherit it), in the background. Per-agent `flock -n` so a
  long run never overlaps itself; different agents may run concurrently.
- Kill switches: `automation/PAUSE` file (gitignored; `touch` to pause the
  whole fleet) and per-agent `enabled: false`.
- `--dry-run` flag: print which agents would run and why, launch nothing.
  Used by tests and for supervised checks.
- Logs: one file per run in the state dir (`logs/<agent>-<timestamp>.log`),
  pruned past 30 days.

### Issue-pipeline agent (`automation/agents/issue-pipeline.md`)

A stateless orchestrator: all state lives in GitHub (labels, PR branches,
comments), so any tick can crash and the next recovers. Each run:

**Phase A — tend existing agent PRs** (open PRs whose branch starts with
`agent/`):

- CI failing → spawn a fix agent in that PR's worktree.
- Visual-review sticky comment (header `visual-review`) has findings not
  yet addressed → spawn a fix agent to fix them or explicitly dismiss each
  with a reasoned reply comment.
- CI green + visual settled + no `agent:reviewed` label → run the
  automated code-review gate: a reviewer subagent examines the full PR
  diff; findings → fix agent (label withheld); clean → add `agent:reviewed`.
- Merge **serially, never in parallel** (the coverage-ratchet floors in
  `ui/vitest.config.ts` conflict between any two UI PRs): squash-merge the
  first ready PR, delete branch and worktree, then update remaining agent
  branches from `main` — resolving coverage-floor conflicts by
  re-measuring on the merged tree per CLAUDE.md — push, and let their CI
  re-run; they merge on a later tick.

**Phase B — pick new work** (only if no agent PR/claimed issue is in
flight):

- List open issues; skip ones labeled `in progress`, `has-dependencies`,
  `needs-clarification`, `idea`, or `blocked`.
- Read the candidates. Underspecified issue → post a clarifying comment,
  add `needs-clarification`, move on. `parallel-safe` label is a strong
  readiness signal but the orchestrator still checks for file overlap
  with in-flight work.
- Issues that plausibly touch the same files are combined into one
  branch/PR (per CLAUDE.md), not worked in parallel.
- For each selection: add `in progress`, comment the branch name
  (`agent/<slug>`), classify complexity — straightforward/scoped → Opus,
  complex/cross-cutting/tricky → Fable — and spawn the worker.

**Phase C — housekeeping**: file GitHub issues for everything workers
reported (next steps, tech debt, tooling friction) and anything the
orchestrator itself hit; print a run summary (captured by the dispatcher's
log).

### Worker / fix / review briefs (`automation/templates/`)

Prompt templates the orchestrator fills in and passes to subagents:

- `worker-brief.md` — implement one issue (or combined set): sibling
  worktree `../kari-website-<slug>` branched from `origin/main`, branch
  `agent/<slug>`; explicitly invoke superpowers skills
  (test-driven-development; systematic-debugging for bug issues;
  verification-before-completion before claiming done); run the full local
  gauntlet (`npm run test:coverage` — never just `test:run` — lint, and
  clippy/fmt/`cargo test` for API changes); mandatory visual check with a
  per-worktree dev stack for UI changes (public pages only when
  `E2E_AUTH0_*` is unset locally — CI's visual review covers admin pages);
  open a PR with `Closes #N` and a squash-worthy title; **finish at
  PR-open** (never wait on CI); return a structured report: what shipped,
  natural next steps, tech debt, problems hit.
- `fix-brief.md` — given a PR and its feedback (CI failure, visual-review
  findings, or code-review findings): work in the PR's existing worktree,
  address each item or dismiss it with a reasoned PR reply, push.
- `review-brief.md` — adversarial code review of a PR diff (correctness,
  tests, conventions); returns findings or a clean verdict. This is the
  merge gate CI and the visual review don't provide.

### Safety rails (encoded in the playbook)

- Only `agent/*` branches; never force-push; never `git checkout` in the
  main clone; never touch prod or approve deployments; ≤1 worker in
  flight (fix agents don't count); merges always squash and serial.
- Headless runs bypass permission prompts by necessity
  (`--dangerously-skip-permissions`); the playbook is the constraint and
  is written defensively. Accepted risk, noted here deliberately.
- Laptop asleep → ticks silently miss; state-in-GitHub makes that safe.

### "What's on test" page (shakedown issue)

Filed as a GitHub issue, to be the pipeline's first end-to-end task, not
built by hand: a route in the app rendered only in the staging build
(flag in `.env.staging`), listing what is deployed to test but not yet
promoted to prod. Client-side fetch of the public GitHub API: latest
successful `production` environment deployment SHA, compared against the
bundle's own `VITE_COMMIT_SHA` (new: injected in `deploy.yml` at build
time); shows the squash-merge PR titles/links in between; empty state
"test == prod". Unauthenticated API is fine: the repo is public and the
rate limit (60/hr/IP) dwarfs personal use.

## Rollout

1. Land the framework PR (this spec, `automation/`, `.gitignore` entry).
2. File the shakedown issue.
3. One supervised manual run of the pipeline playbook (batch capped at 1)
   from an interactive session, watching it work the shakedown issue.
4. Only then install the cron entry (hourly pipeline; dispatcher every
   15 min).

## Decisions log

- Merge gate: CI green + visual findings addressed **+ automated code
  review clean** (chosen over merge-on-green and human-merge).
- Runtime: local cron + headless sessions (chosen over a long-running
  /loop session and manual kick-off) — stateless, crash-proof, survives
  reboots.
- Throughput: hourly ticks, ≤3 workers in flight. (Raised to 30-minute
  ticks on 2026-08-19 after the first live ticks showed the backlog
  growing faster than the pipeline drained it. Cut back on 2026-08-20 to
  hourly ticks with ≤1 worker in flight — the 30m/3-worker throughput
  cost more usage than the backlog was worth.)
- Test-vs-prod visibility: an in-app, staging-only page (chosen over a
  repo script, hosted dashboard, or pinned issue).
- Worker model split: Opus for straightforward tasks, Fable for complex
  ones, chosen per-issue by the orchestrator.
