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
    worker subagents, shepherds the PRs through CI, the visual review,
    and an automated code-review gate, then squash-merges them serially
    into `main` (which auto-deploys to test). How fast it does that is
    tuned by the two values in its agent file — see Throughput below.
  - `backlog-grooming` — roughly every two days (`46h`; the cadence is
    about how often the backlog needs a pass, not about dodging the
    pipeline — both agents are due off the same 15-minute poll grid, so
    no choice of interval reliably keeps them out of the same poll, and
    the re-read below is what makes an overlap safe), curates the open
    issues the pipeline picks from: closes duplicates and already-landed
    work, adds/clears `has-dependencies`, flags file-overlap pairs,
    audits the `bug` label (a priority claim — the pipeline works bugs
    first), and sends the questions only a human can answer to the
    maintainer over the `needs-human` + Telegram protocol. It sets no
    priorities of its own — pick order is computed by
    `backlog-shortlist.sh` below. Never touches
    `in progress` issues (it re-reads an issue's labels immediately
    before each mutation, since the pipeline can claim one mid-tick),
    never files issues, signs every comment `backlog-grooming:`.
- `templates/*.md` — subagent prompt templates the issue-pipeline fills
  in (`{{PLACEHOLDER}}` slots): `plan-brief.md`, `worker-brief.md`,
  `fix-brief.md`, `review-brief.md`.
- `backlog-shortlist.sh` — the pipeline's Phase B candidate feed:
  paginates the whole open backlog through the REST API (no `--limit`
  truncation, no lagging search index), filters out claimed/blocked
  issues, and prints bounded oldest-first JSON slices — `bugs`,
  `maintainer` (no `automation` label — human-filed), `product`
  (agent-filed), `tooling` — with `*_omitted` counts so a capped view
  is visible. Read-only; the header documents the env knobs. Tests:
  `backlog-shortlist-test.sh`.
- `claim-liveness.sh <slug> [issue ...]` — read-only probe behind the
  playbook's stale-claim step: prints one `key=value` line per liveness
  signal for `agent/<slug>` (open PR, worktree and git-dir mtimes,
  branch tips, claimed-issue activity, a `claude` process in the
  worktree), then `alive_by=` and `verdict=ALIVE|DEAD`. Read the
  verdict, not the exit status. Every probe is read-only by design — a
  `git status` that refreshed the index would leave a fresh mtime and no
  claim would ever go stale again — and a probe that fails counts as
  life, so a gh outage cannot release anything.
- `dispatch-test.sh` — test harness for the dispatcher and
  `claim-liveness.sh`; runs in CI (the `shell-lint` job) and locally.
  Run it whenever either script changes.
- `systemd/` — the timer's unit files (source of truth, see
  Installation), installed by `install-timer.sh`. Its test harness,
  `install-timer-test.sh`, runs in the same CI job.

## Adding an agent

Commit one file, `agents/<name>.md`:

```markdown
---
name: my-agent        # required; used for state/lock/log filenames
enabled: true         # anything else disables the agent
every: 1h             # required; Nm / Nh / Nd since last *started* run
                      # (approximate — see "Timing" below)
model: opus           # optional; passed to claude --model
fallback: sonnet      # optional; passed to claude --fallback-model AND
                      # used to retry the tick once when the primary is
                      # out of quota — see "Fallback model" below
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
(pruned after 30 days; every one of them ends in a `tick exited <code>`
line, so no trailer means the tick was SIGKILLed — an OOM — or is still
running, and just above it a `usage:` line — cost, turns, duration and
token counts — plus one `usage <model>:` line per model),
`usage/<name>-<timestamp>.json` — the raw result object each session
returned (`claude -p --output-format json`), kept 180 days
(`KARI_AUTOMATION_USAGE_RETENTION_DAYS`) as the dataset for spend
analysis; a session whose output was not a result object (usage-limit
message, crash) gets `usage: unavailable` in its log and no record;
reading and summing those records needs `jq`, the dispatcher's one
optional dependency — without it a tick still runs and still logs, the
session output is kept verbatim, and both the log line and `--status`
say so (`KARI_AUTOMATION_JQ_BIN` points at a different binary) —
`wip/<slug>-<timestamp>.patch` diffs rescued from dead
workers' worktrees (see Usage limits), and the Telegram transport's own
files — `telegram-offset` and `telegram-threads.json` (which alert a
reply belongs to), `alerts/*.stamp` (the per-condition rate limit) and
`nudge` (see Telegram transport). Token figures count the session's
own API calls as Claude Code reports them; whether background subagents
are folded in is not something the dispatcher can verify, so compare
`--status` totals against the subscription's usage page before trusting
them as absolute. The repo defines *what
and how often*; the machine tracks *when last*.

## Pausing

- Whole fleet: `touch automation/PAUSE` (gitignored; delete to resume).
- One agent: set `enabled: false` in its file.
- Uninstall: `systemctl --user disable --now kari-automation.timer`
  (or remove the cron entry, if installed that way).

## Telegram transport

Alerts out, replies back, on the maintainer's phone. GitHub stays the
source of truth: every reply that arrives is written onto the issue it
answers *before* anything else happens, so a decision made on the phone
is on the record whether or not anyone scrolls back through the chat.
Telegram is transport, nothing more. `automation/telegram.sh` (tests:
`automation/telegram-test.sh`); polling, not webhooks — the laptop has no
public endpoint to receive a callback on.

Unconfigured is a supported state: with no bot token the script prints
one warning line and exits 0, so a fresh clone, CI and the test harnesses
never touch the network and a tick never fails over a phone.

One-time setup:

1. Message [@BotFather](https://t.me/BotFather), `/newbot`, and keep the
   token it gives you.
2. Send the new bot one message from your own account — a bot cannot
   start a conversation, and until it has one message there is no chat to
   read.
3. Read the chat id out of that message:
   `curl https://api.telegram.org/bot<TOKEN>/getUpdates` — it is
   `.result[0].message.chat.id`.
4. Put both in `~/.config/kari-automation/env`, never in the repo:

   ```
   KARI_TELEGRAM_BOT_TOKEN=123456:AA...
   KARI_TELEGRAM_CHAT_ID=987654321
   ```

   `chmod 600` it. The service template loads it with
   `EnvironmentFile=-`, so a missing file is fine (see Installation) —
   and re-running `install-timer.sh` is not needed after editing it, but
   the running timer only picks up changes on its next tick.

What you can send:

- `/pause`, `/resume` — the same `automation/PAUSE` file as Pausing
  above, so the phone and the filesystem cannot disagree.
- `/status` — the compact `dispatch.sh --status-brief` report (short
  emoji-prefixed lines per agent, laid out for a phone; the full
  80-column `--status` with its inter-run gap history stays a terminal
  command), clipped to Telegram's message limit.
- A **reply** to any alert, or a message starting `#<issue> ...` or
  `done <issue> ...` — posted as a comment on that issue prefixed
  "From the maintainer via Telegram: ", which also removes the
  `needs-human` and `blocked` labels and *nudges* the fleet. Anything
  else gets a short help reply listing what the bot understands.

A nudge is a file the next tick consumes: it treats every enabled agent
as due, so an answer is acted on within one 15-minute poll instead of
waiting out the rest of a 6h cadence. `--dry-run` and `--status` never
poll and never consume it — diagnostics change nothing.

What the dispatcher sends, each rate-limited to one message per
`KARI_TELEGRAM_ALERT_INTERVAL` (default 4h) per condition, because a
usage limit kills three or four consecutive ticks and a channel that
buzzes four times for one outage is a channel that gets muted:

- `usage-limit` — ticks whose log ends in a non-zero trailer and mentions
  hitting a limit.
- `tick-failed` — any other non-zero `tick exited` trailer. A log with no
  trailer is neither: it is still running, or was SIGKILLed.
- `lock-<agent>` — a lock held longer than
  `KARI_AUTOMATION_BG_WAIT_CEILING_MS` plus
  `KARI_AUTOMATION_LOCK_ALERT_SLACK` (default 1800s) after the run
  started. That is the wedged tick the log scan cannot see, because it
  never wrote a trailer.

The very first scan after setup is baseline-only — it records where it
got to and sends nothing — so configuring the transport does not open
with 30 days of relitigated history.

## Dispatcher modes

- `dispatch.sh` — a tick: launches whatever is due in the background and
  exits. What the timer calls.
- `dispatch.sh --status` — launches nothing; prints, per agent, the last
  run, the next due time (tolerance included, see Timing), whether its
  lock is held (a run in progress), and the observed inter-run gaps —
  recovered from the `logs/<name>-<timestamp>.log` filenames, so the
  history is the 30-day log window — and runs, total and mean cost
  summed over the retained usage records. Drift shows up as gaps
  creeping past `every`; a stuck agent as a next-due far in the past
  flagged `overdue`, or a lock held long after its last run; a tick
  that cost several times the mean is worth opening the log for.
- `dispatch.sh --dry-run` — launches nothing; one tab-separated
  `<decision> <name> <detail>` line per agent, where the decision is
  `run`, `not-due`, `disabled`, `invalid` or (fleet-wide) `paused`. This
  is the machine-readable contract `dispatch-test.sh` asserts on, so the
  human-readable messages of a real tick can be reworded freely.
- `--wait` — a tick that blocks until every launched agent finishes and
  exits non-zero if any failed. For running a tick by hand (and the test
  harness); the timer must not use it.

Whatever the mode, a tick that creates a log finishes it with a
`tick exited <code>` line — written from an EXIT trap, with TERM/HUP/INT
routed through it, so a scope stop or a timer kill is recorded too.
"Did the tick die, and how?" is then a test on the last line rather than
a guess about what claude printed last; `claim-liveness.sh` reports it as
`tick_log_trailer=`.

## Installation (systemd user timer)

The maintainer's Arch laptop has no cron installed; the fleet runs via
a systemd user timer. The two units are committed under `systemd/` —
those files are the source of truth, not this section, which is why it no
longer inlines them — and one script installs them:

```
automation/install-timer.sh            # install/refresh, then enable
automation/install-timer.sh --dry-run  # report only; write nothing
```

It renders the units into `~/.config/systemd/user/`, runs
`systemctl --user daemon-reload`, and enables/starts the timer. Re-run it
after any change to the unit files; it reports each unit as `installed`,
`updated` or `unchanged`, and every step is idempotent. Read the two
files for the exact content — the parts that are load-bearing rather than
cosmetic:

- `Type=oneshot` with `KillMode=process`. REQUIRED: the dispatcher
  backgrounds the agent sessions and exits, and the default control-group
  KillMode would kill those sessions the moment the oneshot finishes.
- `Environment=PATH=%h/.local/bin:...` — `claude` lives in
  `~/.local/bin`, which the user manager's default PATH does not include.
- `ExecStart` is rendered by the script to the absolute path of the *main
  clone's* `dispatch.sh`, so running the installer from a linked worktree
  still points the timer at a checkout that will outlive it.
- `OnCalendar=*:00/15` with `Persistent=false` — see Timing for what the
  15-minute grid means, and Suspend and sleep for missed slots.

Caveat: user timers only fire while the user is logged in. For ticks
across logouts/reboots, enable lingering: `loginctl enable-linger`.

Alternative for machines that have cron — a single crontab line
(`crontab -e`):

```
*/15 * * * * /home/adamd/Projects/kari-website/automation/dispatch.sh
```

Either way, the 15-minute cadence is the dispatcher's polling
resolution; each agent's own `every` decides how often it runs.

### Each session runs in its own scope

The service unit needs `KillMode=process` (the tick exits while the
sessions run on), so systemd never reaps what a session spawns and
forgets — most often a `./scripts/dev.sh` backgrounded for the visual
check. Three full API+vite stacks, 3.6 GB of RAM and their MinIO
containers were once found idling in the service cgroup hours after
their ticks (#401). So the dispatcher runs each session inside a
transient scope unit (`systemd-run --user --scope`, named
`kari-agent-<name>-<timestamp>.scope`) and, once `claude` exits, stops
the scope if anything is still in it — the tick logs `reap <name>` when
that happens. `systemctl stop` SIGTERMs the whole tree, and dev.sh's
TERM trap takes its container down with it. Like the inhibitor this is
best-effort: no `systemd-run`, or one that cannot reach a user manager
(CI runners, containers), and the session simply runs uncontained.
`systemctl --user list-units 'kari-agent-*'` shows sessions in flight.

The scope also carries `OOMPolicy=continue` and `MemoryMax=50%` (of
RAM; `KARI_AUTOMATION_MEMORY_MAX` overrides). systemd's default policy
for a scope is `stop`, which on 2026-08-21 turned one OOM-killed vitest
worker (4.3 GB, eight times a normal run) into the death of the whole
tick (#412). Now a runaway OOMs against the cap inside its own cgroup —
the kernel kills the biggest process in the scope, not whatever it finds
on the host — and the session carries on; the worker sees a killed
command (exit 137) and reports it like any other failure. A scope that
hit its cap is visible in `journalctl -k` as "Memory cgroup out of
memory" naming the `kari-agent-*` unit. The host also has a 16 GB zstd
zram swap (`zram-generator`, `/etc/systemd/zram-generator.conf`:
`zram-size = min(ram / 2, 16384)`, installed 2026-08-21 after the
incident above) so that a spike outside the fleet degrades into
slowness rather than a kill; `swapon --show` should list `/dev/zram0`.

### Workers get 90 minutes, not 10

`claude -p` ends a session 600 s after its main turn finishes and kills
any background subagents still running. The orchestrator dispatches
workers as background subagents and its own turn routinely ends first,
so the default killed workers ten minutes into 20–40 minute tasks and
stranded their claims for the whole liveness window (#403). The
dispatcher therefore launches every session with
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=5400000` (90 minutes;
`KARI_AUTOMATION_BG_WAIT_CEILING_MS` overrides). Deliberately finite: `0`
would wait forever, and a hung worker would then hold the agent's lock
and stall every later tick. A dispatcher log ending in `Background tasks
still running after …s; terminating` is this ceiling firing.

### The clone keeps itself current

Everything the timer reads — agent files, the playbook, `dispatch.sh`
itself — comes from the main clone's working tree, and nothing else ever
pulls that clone. So each real tick starts with `git fetch` and a
`--ff-only` merge of `origin/main`, and a change merged to `main` is live
on the next tick. (Before this existed, #342's cadence cut sat merged but
inert for 17 hours while the fleet kept ticking on the stale checkout —
#399.) The update is deliberately timid: it only fast-forwards, only when
the clone is on `main`, and any failure — offline, a branch checked out,
local commits — prints a `warn:` line and the tick runs on whatever is on
disk. A stale fleet is always preferred to a stopped one. `--dry-run` and
`--status` never touch the tree; `KARI_AUTOMATION_SELF_UPDATE=0` disables
the step (the test harness sets it).

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
nothing else — it cannot make ticks happen while the host is asleep. It is
also best-effort: where `systemd-inhibit` is missing, or present but unable
to reach logind (headless hosts, containers, CI runners), the dispatcher
warns and runs the tick un-inhibited rather than dropping it.

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

## Throughput (and the usage it costs)

Two values bound how much model usage an agent can burn, and each is
written down in exactly one place — retune by editing them there and
nothing else. For `issue-pipeline`:

- **Tick cadence** — `every:` in the frontmatter of
  `agents/issue-pipeline.md`. Every tick costs orchestration tokens even
  when it finds nothing to do.
- **In-flight worker cap** — `MAX_IN_FLIGHT` in that file's Budget
  section, referred to by name everywhere else in the playbook. Workers,
  and the fix/review agents tending their PRs, are where most of the
  usage goes.

A third lever is *which model* each subagent gets. The policy lives in
the playbook's "Dispatching subagents" section (and nowhere else):
judgment — planning complex work, the code-review gate — gets the
stronger tier; implementation — workers and fix agents — gets the
cheaper one. Retune it by editing that one section.

Read the current values there; this file deliberately doesn't repeat
them. What they do:

- The ceiling on worker starts per hour is `ticks/hour × MAX_IN_FLIGHT`,
  so the two multiply — halving the cadence *and* halving the cap is a
  4x cut to the ceiling.
- Steady-state usage tracks the cap more than the cadence. A PR normally
  needs several ticks to go green, get reviewed, and merge, so the fleet
  rarely reaches that ceiling; what it actually spends is roughly
  proportional to how many PRs are open at once. Cadence mostly sets the
  orchestration floor and how promptly a finished PR gets noticed.

So: cut the cap to spend less, cut the cadence to spend less *often*.
Raising either multiplies usage the same way — a backlog is not on its
own a reason to.

## Usage limits

A tick or subagent that hits a model usage limit simply dies; state
lives in GitHub, so the next due tick recovers — the playbook releases
stale issue claims and re-shepherds open PRs statelessly. A worker this
tick dispatched is alive by construction (the per-agent lock means no
earlier dispatcher tick, and so none of its workers, can still be
running). Any other claim — a playbook run by hand or interactively —
is released only when every sign of life has been silent for a full
liveness window at once: no open PR on the branch, nothing written in
its `../kari-website-<slug>` worktree, no commit on the branch, no
activity on the claimed issues, and no `claude` process working in the
worktree right now — `automation/claim-liveness.sh <slug> <issues>`
prints all of that, one fact per line, and the verdict they add up to.
No single instantaneous sample can declare a worker dead; the cost is
that a tick killed right after a push holds its slot until that window
elapses. See `agents/issue-pipeline.md` for the window
itself. A slug released in a tick is never re-dispatched in that same
tick. On release, uncommitted work in the worktree is saved to
`wip/<slug>-<timestamp>.patch` in the state directory, and an
`agent/<slug>` branch with commits ahead of `main` is pushed and kept
rather than deleted; a `Claim released:` comment on each issue names
both, and the next tick that picks the issue reads that comment, reuses
the kept branch's slug and hands the material to the worker. The
`fallback` model keeps orchestration running through an outage of the
primary (see "Fallback model" below), and the playbook postpones
stronger-tier subagent work (never silently downgrades it) until the
limit window resets.

### Fallback model

`fallback:` covers two different failures, because one flag was not
enough.

`--fallback-model` handles the capacity case: the API is overloaded, and
claude switches models mid-session on its own.

It does **not** handle running out of quota. There the session just
prints the limit and exits, which is how `fallback: opus` sat in
`issue-pipeline.md` for weeks under the comment "keep orchestrating on
Opus when the Fable limit is hit" without once doing so — on 2026-08-25
the Fable quota went at 00:12 and every tick failed for the rest of the
day while Opus was healthy the whole time. So `dispatch.sh` also
**retries the tick once on the fallback model**, and the run log records
a `retry <name>:` line when it does.

Three things bound that retry:

- It fires only on `api_error_status: 429` in the session's result
  object — not on the message text, which has already changed once
  ("You've hit your monthly spend limit" in #322, "You've reached your
  Fable 5 limit" today). A timed-out or crashed tick is never re-run.
- It happens at most once. A *spend* cap is account-wide rather than
  per-model, so the fallback is limited too and the second attempt
  fails as well; without the bound that is an infinite loop.
- It is skipped when the failed attempt already spent more than
  `KARI_AUTOMATION_RETRY_COST_LIMIT` (default $2). Failing at session
  start costs ~2s and $0, so that retry is free; a limit hit deep into
  a tick has already paid for the work, and re-running bills it twice
  with the next tick only a cadence away.

Each attempt keeps its own usage record (`<name>-<stamp>.json` and
`<name>-<stamp>-retry.json`), so `--status` sums what both actually
spent.
