# Automation fleet

Recurring autonomous Claude Code agents whose prompts and configuration
live in this repo. One cron entry on the maintainer's laptop calls
`dispatch.sh` every 15 minutes; it launches whichever agents are due.
Design and decisions:
`docs/superpowers/specs/2026-08-19-automation-fleet-design.md`.

## Layout

- `dispatch.sh` — the dispatcher; the only thing cron calls. Reads every
  `agents/*.md`, launches due+enabled agents headlessly (`claude -p
  --dangerously-skip-permissions`, from the repo root so CLAUDE.md
  loads), one background process per agent with a per-agent lock so runs
  never overlap themselves.
- `agents/*.md` — one file per agent: YAML frontmatter (config) + body
  (the agent's prompt). Current fleet:
  - `issue-pipeline` — picks ready GitHub issues, implements them via
    parallel worker subagents, shepherds the PRs through CI, the visual
    review, and an automated code-review gate, then squash-merges them
    serially into `main` (which auto-deploys to test).
- `templates/*.md` — subagent prompt templates the issue-pipeline fills
  in (`{{PLACEHOLDER}}` slots): `worker-brief.md`, `fix-brief.md`,
  `review-brief.md`.
- `dispatch-test.sh` — local test harness for the dispatcher (not in
  CI). Run it whenever `dispatch.sh` changes.

## Adding an agent

Commit one file, `agents/<name>.md`:

```markdown
---
name: my-agent        # required; used for state/lock/log filenames
enabled: true         # anything else disables the agent
every: 1h             # required; Nm / Nh / Nd since last *started* run
model: opus           # optional; passed to claude --model
---
The agent's full prompt.
```

No dispatcher or cron changes needed. New agents that create work for
the pipeline (e.g. idea-generating scouts) should label their issues
`idea` — the pipeline skips that label until a human triages it off.

## State (laptop-local, never committed)

`~/.local/state/kari-website-automation/` (override:
`KARI_AUTOMATION_STATE_DIR`): `<name>.last-run` timestamps,
`<name>.lock` flock files, and `logs/<name>-<timestamp>.log` per run
(pruned after 30 days). The repo defines *what and how often*; the
machine tracks *when last*.

## Pausing

- Whole fleet: `touch automation/PAUSE` (gitignored; delete to resume).
- One agent: set `enabled: false` in its file.
- Uninstall: remove the cron entry.

## Cron installation

Not yet installed — the pipeline first gets a supervised manual run
(see the spec's Rollout section), and `issue-pipeline` ships
`enabled: false` until that passes. Then:

```
*/15 * * * * /home/adamd/Projects/kari-website/automation/dispatch.sh
```

(`crontab -e`, one line. The 15-minute cadence is the dispatcher's
polling resolution; each agent's own `every` decides how often it runs.)
