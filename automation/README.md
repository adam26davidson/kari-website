# Automation fleet

Recurring autonomous Claude Code agents whose prompts and configuration
live in this repo. A systemd user timer (or cron entry) on the
maintainer's laptop calls `dispatch.sh` every 15 minutes; it launches
whichever agents are due.
Design and decisions:
`docs/superpowers/specs/2026-08-19-automation-fleet-design.md`.

## Layout

- `dispatch.sh` — the dispatcher; the only thing the timer (or cron)
  calls. Reads every
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
                      # (approximate — see "Timing" below)
model: opus           # optional; passed to claude --model
fallback: sonnet      # optional; passed to claude --fallback-model, so a
                      # tick can continue on a smaller model when the
                      # primary's usage limit is hit
---
The agent's full prompt.
```

No dispatcher or cron changes needed. New agents that create work for
the pipeline (e.g. idea-generating scouts) should label their issues
`idea` — the pipeline skips that label until a human triages it off.

## PR ownership: the `agent-pr` label

The issue-pipeline may only review, fix, and merge PRs it owns, and
ownership requires two independent signals: the head branch starts
with `agent/` AND the PR carries the `agent-pr` label. Workers apply
the label right after `gh pr create` (agents push with the
maintainer's `gh` credentials, so PR authorship can't serve as a
second signal — the label is the explicit marker). Neither signal
alone suffices: a human would have to both name a branch `agent/*` and
hand-apply the label for a foreign PR to be adopted by accident.

When the two signals disagree, the pipeline never merges:

- `agent/*` branch without the label: the orchestrator adds the label
  itself only when it can confirm the PR closes an issue the pipeline
  claimed (the issue's claim comment names that exact branch — the
  worker crashed between PR-open and labelling). Otherwise the PR is
  left alone and reported in the run summary for a human to look at.
- `agent-pr` label on a non-`agent/*` branch: left alone and reported
  in the run summary.

## State (laptop-local, never committed)

`~/.local/state/kari-website-automation/` (override:
`KARI_AUTOMATION_STATE_DIR`): `<name>.last-run` timestamps,
`<name>.lock` flock files, `logs/<name>-<timestamp>.log` per run
(pruned after 30 days), and `wip/<slug>-<timestamp>.patch` diffs rescued
from dead workers' worktrees (see Usage limits). The repo defines *what and how often*; the
machine tracks *when last*.

## Pausing

- Whole fleet: `touch automation/PAUSE` (gitignored; delete to resume).
- One agent: set `enabled: false` in its file.
- Uninstall: `systemctl --user disable --now kari-automation.timer`
  (or remove the cron entry, if installed that way).

## Installation (systemd user timer)

The maintainer's Arch laptop has no cron installed; the fleet runs via
a systemd user timer. Two units in `~/.config/systemd/user/`:

`kari-automation.service`:

```ini
[Unit]
Description=kari-website automation dispatcher

[Service]
Type=oneshot
ExecStart=/home/adamd/Projects/kari-website/automation/dispatch.sh
# REQUIRED: the dispatcher backgrounds the agent sessions and exits.
# The default control-group KillMode would kill those sessions the
# moment the oneshot finishes; KillMode=process leaves them running.
KillMode=process
# `claude` lives in ~/.local/bin, which the user manager's default
# PATH does not include.
Environment=PATH=/home/adamd/.local/bin:/usr/local/bin:/usr/bin:/bin
```

`kari-automation.timer`:

```ini
[Unit]
Description=Run the kari-website automation dispatcher every 15 minutes

[Timer]
OnCalendar=*:00/15

[Install]
WantedBy=timers.target
```

Enable with:

```
systemctl --user daemon-reload
systemctl --user enable --now kari-automation.timer
```

Caveat: user timers only fire while the user is logged in. For ticks
across logouts/reboots, enable lingering: `loginctl enable-linger`.

Alternative for machines that have cron — a single crontab line
(`crontab -e`):

```
*/15 * * * * /home/adamd/Projects/kari-website/automation/dispatch.sh
```

Either way, the 15-minute cadence is the dispatcher's polling
resolution; each agent's own `every` decides how often it runs.

## Timing

`every` means *about* every N, not exactly. `<name>.last-run` is stamped
when a run **starts** (deliberately: a long run must not re-trigger the
moment it finishes), while polls land on cron's coarse grid. Without
slack, a run that starts a few seconds after a poll boundary pushes the
next one a whole poll later, and the offset accumulates — an `every: 1h`
agent creeps towards running every 75 minutes (#276).

So an agent counts as due once `now - last >= every - tolerance`, with
the tolerance defaulting to 120s (override with
`KARI_AUTOMATION_DUE_TOLERANCE`; clamped so a tolerance wider than the
interval simply means "every poll"). Phase is held rather than drifting;
a run may start up to the tolerance early.

The override is whole seconds — a bare `120`, *not* the `Nm`/`Nh`
syntax `every` takes, and without leading zeros (bash arithmetic would
read `0120` as octal 80). Anything else is reported on stderr and the
default is used, so a typo can't take the fleet down.

Sizing it: the tolerance only needs to exceed the per-cycle start lag —
the delay between a poll firing and `last-run` being stamped, observed
at ~37s — so 120s covers it with room to spare. It is deliberately far
below the 15-minute poll period, and retuning it (say, after changing
the cron cadence) should track that start lag rather than the cadence: a
tolerance near the poll period would let an `every: 1h` agent
legitimately start up to ~14 minutes early.

## Suspend and sleep (host power settings)

A sleeping laptop runs no ticks, and a suspend mid-tick severs the
agent's in-flight API request. Both happened on 2026-08-19: the fleet
merged four PRs, then the host idle-suspended at 20:32 (that tick's log
contains only `Request timed out`), slept 21:44–07:45, and suspended
again three minutes after waking. Two independent defences are needed —
the repo covers one, the host must cover the other.

**Handled in-repo:** every tick runs under
`systemd-inhibit --what=sleep:idle --mode=block`, so the host cannot
suspend while an agent is working. Confirm a live tick holds it with
`systemd-inhibit --list | grep kari`. This protects a *running* tick and
nothing else — it cannot make ticks happen while the host is asleep.

**Must be configured on the host:** disabling idle-suspend so ticks fire
overnight. The trigger is *inactivity*, not the lid, so leaving the lid
open does not help by itself.

### KDE Plasma 6.7

The setting moved in 6.7 — older guides (and the KDE docs' "Suspend
Session" section) describe a layout that no longer matches. The current
profile group is `SuspendAndShutdown`, and `AutoSuspendAction` takes a
`PowerButtonAction` value where `0` is `NoAction`
(`daemon/powerdevilenums.h`, `PowerDevilProfileSettings.kcfg`):

```bash
# Disable automatic suspend on AC only, then reload PowerDevil.
kwriteconfig6 --file powerdevilrc \
  --group AC --group SuspendAndShutdown --key AutoSuspendAction 0
systemctl --user restart plasma-powerdevil.service

# Verify (expect: 0)
kreadconfig6 --file powerdevilrc \
  --group AC --group SuspendAndShutdown --key AutoSuspendAction
```

Revert by setting the value to `1` (Sleep) and restarting the service.

The **Battery** and **LowBattery** profiles are deliberately left
untouched: an unplugged laptop should still sleep rather than drain
flat, which also means overnight runs require the charger. KDE's battery
profile is far more aggressive than AC — a three-minute idle suspend was
observed on battery.

**Stale-config caveat:** settings written by an older Plasma live under
the previous group name (e.g. `[AC][SuspendAndPowerButton]` with
`lidAction`) and are silently inert under 6.7, which reads
`[AC][SuspendAndShutdown]` / `LidAction`. A power preference that
"should already be set" may not be in effect — check the new group
before concluding anything.

### Diagnosing a suspend-killed tick

- Log contains only `Request timed out` — suspended mid-tick; the
  agent's in-flight API connection died.
- Zero-byte log with a fresh `last-run` stamp — the tick started, then
  the host suspended before it wrote anything.
- No log at all for expected slots — the host was asleep when the timer
  should have fired.

Confirm against the kernel journal, which is authoritative:

```bash
journalctl --since "yesterday 20:00" | grep -E "PM: suspend (entry|exit)"
```

Note the timer uses `Persistent=false`, so slots missed while asleep are
not replayed; on resume systemd fires the overdue timer once, and the
schedule continues from there.

### Running while logged out

User timers only run while the user has a session unless lingering is
enabled: `loginctl enable-linger`. This is orthogonal to suspend — it
covers logout and pre-login boot, and does nothing for a sleeping host.

## Usage limits

A tick or subagent that hits a model usage limit simply dies; state
lives in GitHub, so the next due tick recovers — the playbook releases
stale issue claims (`in progress` with no PR, once the worker is
provably dead: no tick process predating the claim and no recent pushed
commit on its `agent/*` branch; after 2h of silence if it cannot tell)
and re-shepherds open PRs statelessly. Uncommitted work in a dead
worker's worktree is saved to `wip/<slug>-<timestamp>.patch` in the
state directory before the worktree is removed. The `fallback` model keeps orchestration running
through a Fable outage, and the playbook postpones Fable-tier subagent
work (never silently downgrades it) until the limit window resets.
