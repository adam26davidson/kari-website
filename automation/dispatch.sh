#!/usr/bin/env bash
# Fleet dispatcher: the only thing the systemd timer (or cron) calls.
# Reads agent definitions (YAML frontmatter + prompt body) from
# automation/agents/, launches each enabled agent whose interval has
# elapsed as a headless Claude session from the repo root, and records
# last-run/locks/logs in a laptop-local state dir. See
# automation/README.md; the timer itself is installed by
# automation/install-timer.sh.
#
#   dispatch.sh            # a tick: launch whatever is due, in the background
#   dispatch.sh --dry-run  # one "<decision>\t<name>\t<detail>" line per agent
#                          # (run | not-due | disabled | invalid | paused),
#                          # launching nothing — stable for scripts and tests
#   dispatch.sh --status   # per agent: last run, next due (tolerance
#                          # included), lock state, observed inter-run gaps
#   dispatch.sh --wait     # a tick that blocks until its launches finish
#
# Every per-run log ends in a "tick exited <code>" line (written by an
# EXIT trap, signals included), so a reader — automation/claim-liveness.sh
# in particular — can tell a finished tick from one that was killed hard
# without guessing at claude's last line. No trailer = SIGKILLed or still
# running.
#
# Env overrides (used by dispatch-test.sh):
#   KARI_AUTOMATION_STATE_DIR   default ~/.local/state/kari-website-automation
#   KARI_AUTOMATION_AGENTS_DIR  default <repo>/automation/agents
#   KARI_AUTOMATION_PAUSE_FILE  default <repo>/automation/PAUSE
#   KARI_AUTOMATION_CLAUDE_BIN  default claude
#   KARI_AUTOMATION_INHIBIT_BIN default systemd-inhibit (skipped if absent)
#   KARI_AUTOMATION_SYSTEMD_RUN_BIN default systemd-run (skipped if absent);
#   KARI_AUTOMATION_SYSTEMCTL_BIN   default systemctl — see launch()
#   KARI_AUTOMATION_MEMORY_MAX  default 50% (of RAM); MemoryMax of the
#                               scope each agent session runs in
#   KARI_AUTOMATION_DUE_TOLERANCE  default 120 (seconds); see DUE_TOLERANCE
#   KARI_AUTOMATION_BG_WAIT_CEILING_MS default 5400000 (90 minutes); how
#                               long claude -p waits for background
#                               subagents after the main turn ends
#   KARI_AUTOMATION_SELF_UPDATE default 1; 0 skips the fast-forward of the
#                               clone at the start of a tick (see self_update)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_DIR="${KARI_AUTOMATION_AGENTS_DIR:-$REPO_ROOT/automation/agents}"
STATE_DIR="${KARI_AUTOMATION_STATE_DIR:-$HOME/.local/state/kari-website-automation}"
PAUSE_FILE="${KARI_AUTOMATION_PAUSE_FILE:-$REPO_ROOT/automation/PAUSE}"
CLAUDE_BIN="${KARI_AUTOMATION_CLAUDE_BIN:-claude}"
SELF_UPDATE="${KARI_AUTOMATION_SELF_UPDATE:-1}"
INHIBIT_BIN="${KARI_AUTOMATION_INHIBIT_BIN:-systemd-inhibit}"
SYSTEMD_RUN_BIN="${KARI_AUTOMATION_SYSTEMD_RUN_BIN:-systemd-run}"
SYSTEMCTL_BIN="${KARI_AUTOMATION_SYSTEMCTL_BIN:-systemctl}"
MEMORY_MAX="${KARI_AUTOMATION_MEMORY_MAX:-50%}"
# claude -p ends the session 600s after its main turn finishes, killing
# any background subagents still running. The orchestrator dispatches
# workers as background subagents and its own turn routinely ends before
# they do, so the default ceiling killed a worker ten minutes into a
# 20-40 minute task, stranding its claim for the liveness window (#403).
# 90 minutes covers a slow worker plus the fix/review agents tending its
# PR. Deliberately not 0 ("wait indefinitely"): a hung worker would then
# hold the agent's flock forever and stall every later tick.
BG_WAIT_CEILING_MS="${KARI_AUTOMATION_BG_WAIT_CEILING_MS:-5400000}"
# Slack on the "has the interval elapsed?" test. Polls happen on a coarse
# grid (cron every 15m) while last-run is stamped at the moment a run
# starts, so without slack each cycle's start creeps later into the
# polling window and an `every: 1h` agent drifts towards running every
# 75m. The tolerance only has to cover that per-cycle start lag — the
# poll-to-stamp delay, observed at ~37s — not a whole poll period, so
# 120s absorbs it with headroom while capping how early a run may start.
# Size it against the start lag, not the cron cadence: a tolerance near
# the poll period would let an `every: 1h` agent fire ~14m early. Result:
# "about every N", with the phase held instead of accumulating drift.
DUE_TOLERANCE="${KARI_AUTOMATION_DUE_TOLERANCE:-120}"
# Validated up front, the way `every` is (see interval_seconds): a
# non-integer here — say `2m`, borrowing the duration syntax `every`
# uses — would blow up the arithmetic inside the dispatch loop, and
# under `set -e` that aborts the loop wholesale. Every agent would be
# skipped while the script still exited 0, so cron would see success and
# a dead fleet would stay invisible. Warn and fall back instead.
# Leading zeros are rejected too, because bash arithmetic reads them as
# octal: `090` is a "value too great for base" error — the same silent
# fleet death this check exists to prevent — and `0120` is a quieter
# version of it, applying 80s while the operator reads 120.
if ! [[ "$DUE_TOLERANCE" =~ ^(0|[1-9][0-9]*)$ ]]; then
  echo "unusable KARI_AUTOMATION_DUE_TOLERANCE '$DUE_TOLERANCE'" \
    "(want whole seconds, no leading zeros, e.g. 120); using 120" >&2
  DUE_TOLERANCE=120
fi

MODE=run
WAIT=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dry-run ;;
    --status) MODE=status ;;
    --wait) WAIT=true ;;
    *)
      echo "usage: $(basename "$0") [--dry-run | --status] [--wait]" >&2
      exit 2
      ;;
  esac
done

# One line per agent in --dry-run: tab-separated so scripts (and
# dispatch-test.sh) can read the decision column without depending on the
# human-readable wording the other modes use.
decision() { # decision <decision> <name> [detail]
  printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}"
}

STATUS_GAPS_SHOWN=12

fmt_time() { date -d "@$1" '+%Y-%m-%d %H:%M:%S'; }

fmt_duration() { # fmt_duration <seconds> -> 2d04h | 1h03m | 5m07s | 42s
  local s="$1"
  if [ "$s" -ge 86400 ]; then
    printf '%dd%02dh' $((s / 86400)) $((s % 86400 / 3600))
  elif [ "$s" -ge 3600 ]; then
    printf '%dh%02dm' $((s / 3600)) $((s % 3600 / 60))
  elif [ "$s" -ge 60 ]; then
    printf '%dm%02ds' $((s / 60)) $((s % 60))
  else
    printf '%ds' "$s"
  fi
}

# Start times (epoch seconds, ascending) of every logged run: each run
# writes logs/<name>-<YYYYmmddTHHMMSS>.log, so the log dir is already a
# 30-day run history. An agent must not claim the logs of another whose
# name extends its own, and the glob alone cannot tell them apart -- for
# agents "a" and "a-2", "a-2-<ts>.log" matches any "a-"* pattern a
# timestamp would. So the suffix is matched exactly, and anything that is
# not a bare timestamp (it belongs to a longer-named sibling) is skipped
# before date ever sees it.
run_starts() { # run_starts <name>
  local f ts
  for f in "$STATE_DIR/logs/$1-"[0-9]*T[0-9]*.log; do
    [ -e "$f" ] || continue
    ts="${f##*/}"
    ts="${ts#"$1-"}"
    ts="${ts%.log}"
    [[ "$ts" =~ ^[0-9]{8}T[0-9]{6}$ ]] || continue
    date -d "${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:9:2}:${ts:11:2}:${ts:13:2}" +%s
  done | sort -n
}

# "1h00m 1h15m (3 runs logged, mean 1h07m)" — gaps oldest first, so drift
# reads left to right; only the newest few are listed (the mean covers all
# of them) because 30 days of an `every: 30m` agent is over a thousand.
# Drift shows up as gaps creeping past `every`; a stuck agent as a
# next-due far in the past (see status_report).
observed_gaps() { # observed_gaps <name>
  local starts=() prev="" gaps=() total=0 t
  mapfile -t starts < <(run_starts "$1")
  if [ "${#starts[@]}" -eq 0 ]; then
    echo "(no runs logged)"
    return
  fi
  for t in "${starts[@]}"; do
    if [ -n "$prev" ]; then
      gaps+=("$(fmt_duration $((t - prev)))")
      total=$((total + t - prev))
    fi
    prev="$t"
  done
  if [ "${#gaps[@]}" -eq 0 ]; then
    echo "(1 run logged, no gaps yet)"
    return
  fi
  # (A negative slice past the array start yields nothing, hence the clamp.)
  local first=0 note=""
  if [ "${#gaps[@]}" -gt "$STATUS_GAPS_SHOWN" ]; then
    first=$((${#gaps[@]} - STATUS_GAPS_SHOWN))
    note=" showing last $STATUS_GAPS_SHOWN,"
  fi
  local shown=("${gaps[@]:first}")
  echo "${shown[*]} (${#starts[@]} runs logged,$note" \
    "mean $(fmt_duration $((total / ${#gaps[@]}))))"
}

status_report() { # <name> <enabled> <every> <model> <last> <due_at> <now>
  local name="$1" enabled="$2" every="$3" model="$4" last="$5" due_at="$6"
  local now="$7" lock="$STATE_DIR/$name.lock" lock_state=free
  echo "$name  every=$every  model=${model:-default}"
  if [ "$last" -eq 0 ]; then
    echo "  last-run: never"
  else
    echo "  last-run: $(fmt_time "$last") ($(fmt_duration $((now - last))) ago)"
  fi
  if [ "$enabled" != "true" ]; then
    echo "  next-due: n/a (disabled)"
  elif [ "$last" -eq 0 ]; then
    echo "  next-due: now"
  elif [ "$due_at" -gt "$now" ]; then
    echo "  next-due: $(fmt_time "$due_at")" \
      "(in $(fmt_duration $((due_at - now))); tolerance ${DUE_TOLERANCE}s)"
  else
    echo "  next-due: $(fmt_time "$due_at")" \
      "(overdue by $(fmt_duration $((now - due_at))))"
  fi
  # A read-only open so --status never creates lock files as a side effect.
  if [ -e "$lock" ] && ! (flock -n 9) 9<"$lock"; then
    lock_state="held (run in progress)"
  fi
  echo "  lock:     $lock_state"
  echo "  gaps:     $(observed_gaps "$name")"
}

# First "key: value" between the first two --- lines of an agent file.
frontmatter() { # frontmatter <file> <key>
  awk -v key="$2" '
    /^---[[:space:]]*$/ { n++; next }
    n == 1 && $1 == key":" {
      sub(/^[^:]*:[[:space:]]*/, "")
      sub(/[[:space:]]*(#.*)?$/, "")
      print
      exit
    }
    n >= 2 { exit }
  ' "$1"
}

# Everything after the second --- line: the agent's prompt.
prompt_body() { # prompt_body <file>
  awk '/^---[[:space:]]*$/ && n < 2 { n++; next } n >= 2 { print }' "$1"
}

interval_seconds() { # interval_seconds <Nm|Nh|Nd>
  case "$1" in
    *m) echo $((${1%m} * 60)) ;;
    *h) echo $((${1%h} * 3600)) ;;
    *d) echo $((${1%d} * 86400)) ;;
    *)
      echo "unparseable interval '$1' (want Nm/Nh/Nd)" >&2
      return 1
      ;;
  esac
}

# shellcheck disable=SC2329  # invoked from launch()'s EXIT trap
tick_trailer() { # tick_trailer <log> <code> — the last line of every run log
  local log="$1" code="$2"
  if [ -s "$log" ] && [ -n "$(tail -c1 "$log")" ]; then echo >>"$log"; fi
  echo "tick exited $code" >>"$log"
}

launch() { # launch <name> <model> <fallback> <agent-file> — backgrounded
  local name="$1" model="$2" fallback="$3" agent_file="$4"
  local stamp log
  stamp="$(date +%Y%m%dT%H%M%S)"
  log="$STATE_DIR/logs/$name-$stamp.log"
  (
    flock -n 9 || {
      echo "skip $name: previous run still holds the lock"
      exit 0
    }
    # Every log this run creates ends in a "tick exited <code>" line, so
    # "did the tick die, and how?" is a test on the last line rather than
    # pattern-matching whatever claude happened to print last (#325). The
    # traps are installed AFTER the flock so the skip path above — which
    # never creates a log — writes nothing. TERM/HUP/INT are turned into
    # a normal exit because bash does not run an EXIT trap on an
    # untrapped fatal signal, and a scope stop or a timer kill arrives
    # that way. SIGKILL (the OOM killer) can never write a trailer: a log
    # without one means "killed hard, or still running".
    # $? is passed as an argument so it is read before anything else in
    # the trap can clobber it — the newline guard below runs a command.
    # The guard exists because a session killed mid-line (claude prints
    # "You've hit your session limit" with no trailing newline) would
    # otherwise get the trailer glued onto that message, hiding both.
    trap 'tick_trailer "$log" "$?"' EXIT
    trap 'exit 143' TERM HUP INT
    date +%s >"$STATE_DIR/$name.last-run"
    echo "run $name -> $log"
    cd "$REPO_ROOT"
    # Hold a sleep+idle inhibitor for the life of the tick. Without it an
    # idle-suspend mid-tick severs the agent's in-flight API request and the
    # run dies part-done (observed 2026-08-19: a tick suspended two minutes
    # in and came back only to fail with "Request timed out"). Optional by
    # design: on a host without systemd-inhibit the tick still runs.
    # "Optional" has to cover present-but-unusable, not just absent —
    # systemd-inhibit ships with systemd but exits non-zero when there is no
    # logind/D-Bus session to take a lock from (headless hosts, containers,
    # CI runners). Wrapping the launch in it regardless would abort the tick
    # before claude ever starts, losing the run to protect it from a suspend
    # that cannot happen. So probe it on a no-op first and drop it if it
    # can't hold a lock.
    local inhibit=()
    if command -v "$INHIBIT_BIN" >/dev/null 2>&1; then
      if "$INHIBIT_BIN" --what=sleep:idle --mode=block \
        --who="kari-automation" --why="inhibitor probe" true >/dev/null 2>&1
      then
        inhibit=("$INHIBIT_BIN" --what=sleep:idle --mode=block
          --who="kari-automation" --why="agent tick: $name")
      else
        echo "warn: $INHIBIT_BIN cannot take a lock;" \
          "running $name without sleep inhibition" >&2
      fi
    fi
    # Contain the session in a transient scope unit of its own, and stop
    # the scope once claude exits. The service unit has to use
    # KillMode=process (the tick exits while the session runs on), so
    # nothing else ever reaps what a session spawns and forgets -- most
    # often a `./scripts/dev.sh` backgrounded for the visual check: three
    # full API+vite stacks, 3.6G of RAM, and their MinIO containers were
    # found idling in the service cgroup hours after their ticks (#401).
    # With a scope, the whole tree is one cgroup and `systemctl stop`
    # SIGTERMs all of it; dev.sh's TERM trap brings its container down
    # too. Same optionality as the inhibitor: no systemd-run, or one that
    # cannot reach a user manager (CI runners, containers), means the
    # session simply runs unscoped rather than not at all.
    local scope=() unit=""
    if command -v "$SYSTEMD_RUN_BIN" >/dev/null 2>&1; then
      if "$SYSTEMD_RUN_BIN" --user --scope --quiet -- true >/dev/null 2>&1
      then
        unit="kari-agent-$name-$stamp"
        # OOMPolicy: systemd's default for a scope is `stop`, which turned
        # one OOM-killed vitest worker into the death of the whole tick
        # (2026-08-21, #412) -- the opposite of what the scope is for.
        # `continue` lets the kernel take the one process and the session
        # carry on. MemoryMax keeps that kill inside the scope's own
        # cgroup: a runaway then OOMs against the cap and the kernel
        # picks the biggest process in the scope, not whatever it finds
        # on the host. Half the machine leaves the desktop breathing
        # room on a host with no swap.
        scope=("$SYSTEMD_RUN_BIN" --user --scope --quiet --unit="$unit"
          --property=OOMPolicy=continue --property="MemoryMax=$MEMORY_MAX" --)
      else
        echo "warn: $SYSTEMD_RUN_BIN cannot create a scope;" \
          "running $name uncontained" >&2
      fi
    fi
    # CI=true: vitest runs once instead of entering watch mode even when
    # invoked bare, and Playwright/npm go non-interactive -- what a
    # headless session wants anyway. A worker that left vitest watching
    # for ~30 minutes grew five workers to V8's ~4 GB heap cap each and
    # OOMed the host (2026-08-21, #412/#415); the same code ran once in
    # 1.5 GB.
    # Unquoted ${var:+...} is deliberate: no flag at all when unset.
    # `|| rc=$?` rather than a bare status read: under set -e a failing
    # session would otherwise end the subshell here, before the reap.
    local rc=0
    # shellcheck disable=SC2086
    prompt_body "$agent_file" |
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="$BG_WAIT_CEILING_MS" \
      CI=true \
      "${scope[@]}" "${inhibit[@]}" "$CLAUDE_BIN" -p \
        --dangerously-skip-permissions \
        ${model:+--model "$model"} \
        ${fallback:+--fallback-model "$fallback"} >"$log" 2>&1 || rc=$?
    # Only a scope that still has processes in it is "stopped"; an empty
    # one was already collected, and a session that cleaned up after
    # itself deserves a quiet exit.
    if [ -n "$unit" ] &&
      "$SYSTEMCTL_BIN" --user is-active --quiet "$unit.scope" 2>/dev/null
    then
      echo "reap $name: stopping leftover processes in $unit.scope"
      "$SYSTEMCTL_BIN" --user stop "$unit.scope" 2>/dev/null || true
    fi
    exit "$rc"
  ) 9>"$STATE_DIR/$name.lock" &
  if $WAIT; then
    LAUNCHED+=("$!")
  else
    disown
  fi
}
LAUNCHED=()

# Bring the clone the timer runs from up to date with origin/main before
# reading anything from it. The agent files, the playbook and this script
# are all read from REPO_ROOT, and nothing else ever pulls that clone: a
# cadence cut merged to main sat inert for 17 hours (2026-08-20, #399)
# while the fleet kept ticking on the stale checkout. Fast-forward only,
# and only on main -- a maintainer who has checked out a branch or left
# local edits in the clone keeps them; the tick just warns and runs on
# what is on disk. Nothing here may fail the tick: offline, no remote,
# diverged history all degrade to "stale but running", which is the
# state the fleet was in before this existed.
self_update() {
  [ "$SELF_UPDATE" = 1 ] || return 0
  local branch
  branch="$(git -C "$REPO_ROOT" symbolic-ref --short -q HEAD 2>/dev/null)" ||
    branch=""
  if [ "$branch" != main ]; then
    echo "warn: $REPO_ROOT is on '${branch:-detached HEAD}', not main;" \
      "running without self-update" >&2
    return 0
  fi
  if ! git -C "$REPO_ROOT" fetch -q origin main 2>/dev/null; then
    echo "warn: fetch of origin/main failed; running on the current checkout" >&2
    return 0
  fi
  local before after
  before="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  if ! git -C "$REPO_ROOT" merge -q --ff-only origin/main 2>/dev/null; then
    echo "warn: cannot fast-forward $REPO_ROOT to origin/main" \
      "(local commits or edits?); running on $before" >&2
    return 0
  fi
  after="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  [ "$before" = "$after" ] || echo "self-update: $before -> $after"
}

if [ -e "$PAUSE_FILE" ]; then
  case "$MODE" in
    status) echo "fleet paused ($PAUSE_FILE exists) — nothing will launch" ;;
    dry-run)
      decision paused '*' "$PAUSE_FILE"
      exit 0
      ;;
    *)
      echo "fleet paused ($PAUSE_FILE exists) — remove it to resume"
      exit 0
      ;;
  esac
fi

mkdir -p "$STATE_DIR/logs"

# Only a real tick updates: --dry-run and --status are diagnostics and
# must not change the tree under the operator reading them.
[ "$MODE" = run ] && self_update

for agent_file in "$AGENTS_DIR"/*.md; do
  [ -e "$agent_file" ] || continue
  name="$(frontmatter "$agent_file" name)"
  enabled="$(frontmatter "$agent_file" enabled)"
  every="$(frontmatter "$agent_file" every)"
  model="$(frontmatter "$agent_file" model)"
  fallback="$(frontmatter "$agent_file" fallback)"

  if [ -z "$name" ] || [ -z "$every" ]; then
    echo "SKIP $(basename "$agent_file"): missing name/every frontmatter" >&2
    [ "$MODE" = dry-run ] &&
      decision invalid "$(basename "$agent_file")" "missing name/every"
    continue
  fi
  if ! secs="$(interval_seconds "$every")"; then
    echo "SKIP $name: bad interval" >&2
    [ "$MODE" = dry-run ] && decision invalid "$name" "bad interval '$every'"
    continue
  fi

  now="$(date +%s)"
  last=0
  [ -f "$STATE_DIR/$name.last-run" ] && last="$(cat "$STATE_DIR/$name.last-run")"
  # Clamped so a tolerance wider than the interval just means "every poll"
  # rather than a negative threshold.
  due_after=$((secs - DUE_TOLERANCE))
  [ "$due_after" -lt 0 ] && due_after=0
  due_at=$((last + due_after))

  if [ "$MODE" = status ]; then
    status_report "$name" "$enabled" "$every" "$model" "$last" "$due_at" "$now"
    continue
  fi
  if [ "$enabled" != "true" ]; then
    case "$MODE" in
      dry-run) decision disabled "$name" ;;
      *) echo "skip $name: disabled" ;;
    esac
    continue
  fi
  if [ "$now" -lt "$due_at" ]; then
    case "$MODE" in
      dry-run) decision not-due "$name" "remaining=$((due_at - now))s" ;;
      *) echo "skip $name: not due ($((due_at - now))s remaining)" ;;
    esac
    continue
  fi

  if [ "$MODE" = dry-run ]; then
    decision run "$name" "model=${model:-default} every=$every"
    continue
  fi
  launch "$name" "$model" "$fallback" "$agent_file"
done

find "$STATE_DIR/logs" -type f -mtime +30 -delete 2>/dev/null || true

# --wait: block on every launch (and fail if any did), for manual ticks and
# the test harness; a timer-driven tick exits as soon as they are forked.
status=0
for pid in "${LAUNCHED[@]}"; do
  wait "$pid" || status=1
done
exit "$status"
