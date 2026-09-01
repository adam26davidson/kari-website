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
#                          # included), lock state, observed inter-run gaps,
#                          # and runs/cost over the retained usage records
#   dispatch.sh --status-brief
#                          # the same picture laid out for a phone: short
#                          # emoji-prefixed lines, no gap forensics. This
#                          # is what telegram.sh sends for /status, where
#                          # 80-column terminal text wraps illegibly
#   dispatch.sh --wait     # a tick that blocks until its launches finish
#
# Every per-run log ends in a "tick exited <code>" line (written by an
# EXIT trap, signals included), so a reader — automation/claim-liveness.sh
# in particular — can tell a finished tick from one that was killed hard
# without guessing at claude's last line. No trailer = SIGKILLed or still
# running. Just above the trailer sits a "usage:" line — cost, turns,
# duration and token counts for the session — and the raw JSON it came
# from is kept under $STATE_DIR/usage/ (see record_usage) so spend can be
# analysed rather than guessed at.
#
# Env overrides (used by dispatch-test.sh):
#   KARI_AUTOMATION_STATE_DIR   default ~/.local/state/kari-website-automation
#   KARI_AUTOMATION_AGENTS_DIR  default <repo>/automation/agents
#   KARI_AUTOMATION_PAUSE_FILE  default <repo>/automation/PAUSE
#   KARI_AUTOMATION_CLAUDE_BIN  default claude
#   KARI_AUTOMATION_JQ_BIN      default jq; record_usage/usage_summary
#                               degrade gracefully when it is absent
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
#   KARI_AUTOMATION_USAGE_RETENTION_DAYS default 180; how long the per-run
#                               usage JSON under $STATE_DIR/usage/ is kept
#   KARI_AUTOMATION_RETRY_COST_LIMIT default 2 (USD); a usage-limited
#                               attempt that already spent more than this
#                               is not retried on the fallback model —
#                               see retry_on_fallback
#   KARI_AUTOMATION_TELEGRAM_BIN default <repo>/automation/telegram.sh;
#                               polled at the top of every tick and used
#                               for the alerts below. Unconfigured (no
#                               bot token) it is a no-op, so nothing here
#                               depends on a phone being set up
#   KARI_TELEGRAM_ALERT_INTERVAL default 4h (Nm/Nh/Nd); at most one
#                               alert per condition per interval — see
#                               send_alert
#   KARI_AUTOMATION_LOCK_ALERT_SLACK default 1800 (seconds), added to
#                               BG_WAIT_CEILING_MS before a held lock is
#                               called hung — see telegram_lock_alerts
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_DIR="${KARI_AUTOMATION_AGENTS_DIR:-$REPO_ROOT/automation/agents}"
STATE_DIR="${KARI_AUTOMATION_STATE_DIR:-$HOME/.local/state/kari-website-automation}"
PAUSE_FILE="${KARI_AUTOMATION_PAUSE_FILE:-$REPO_ROOT/automation/PAUSE}"
CLAUDE_BIN="${KARI_AUTOMATION_CLAUDE_BIN:-claude}"
JQ_BIN="${KARI_AUTOMATION_JQ_BIN:-jq}"
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
# This is the first arithmetic use of the ceiling (telegram_lock_alerts
# divides it by 1000), so it gets the same guard DUE_TOLERANCE has: an
# unusable value would blow up inside the alert scan and, under set -e,
# take the rest of the tick down with it.
if ! [[ "$BG_WAIT_CEILING_MS" =~ ^(0|[1-9][0-9]*)$ ]]; then
  echo "unusable KARI_AUTOMATION_BG_WAIT_CEILING_MS" \
    "'$BG_WAIT_CEILING_MS' (want whole ms, no leading zeros);" \
    "using 5400000" >&2
  BG_WAIT_CEILING_MS=5400000
fi
USAGE_RETENTION_DAYS="${KARI_AUTOMATION_USAGE_RETENTION_DAYS:-180}"
RETRY_COST_LIMIT="${KARI_AUTOMATION_RETRY_COST_LIMIT:-2}"
# The phone channel (automation/telegram.sh, #463): polled for replies at
# the top of every tick, and sent the mechanical alerts below. Nothing on
# this path may fail a tick — an unconfigured or unreachable transport
# means a fleet that runs silently, never a fleet that stops.
TELEGRAM_BIN="${KARI_AUTOMATION_TELEGRAM_BIN:-$REPO_ROOT/automation/telegram.sh}"
ALERT_INTERVAL="${KARI_TELEGRAM_ALERT_INTERVAL:-4h}"
# Extra seconds on top of the background-wait ceiling before a held lock
# reads as a hang. The ceiling only bounds how long claude waits for
# background subagents AFTER the main turn ends; a long main turn sits on
# top of that, and an alert that fires on every slow-but-healthy tick is
# an alert that gets muted.
LOCK_ALERT_SLACK="${KARI_AUTOMATION_LOCK_ALERT_SLACK:-1800}"
if ! [[ "$LOCK_ALERT_SLACK" =~ ^(0|[1-9][0-9]*)$ ]]; then
  echo "unusable KARI_AUTOMATION_LOCK_ALERT_SLACK '$LOCK_ALERT_SLACK'" \
    "(want whole seconds, no leading zeros, e.g. 1800); using 1800" >&2
  LOCK_ALERT_SLACK=1800
fi
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
    # Quoted so shellcheck does not read the hyphen as subtraction (SC2100).
    --status-brief) MODE="status-brief" ;;
    --wait) WAIT=true ;;
    *)
      echo "usage: $(basename "$0")" \
        "[--dry-run | --status | --status-brief] [--wait]" >&2
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
  echo "  usage:    $(usage_summary "$name")"
}

# The same report, laid out for a phone rather than an 80-column
# terminal: a few short lines per agent instead of aligned columns that
# wrap into porridge inside a Telegram bubble. Plain text and emoji only
# — nothing here is sent with a parse_mode, so an agent name or a
# jq-built usage string can never need escaping. Deliberately NOT a
# superset of --status: the observed gaps are drift forensics worth
# reading at a desk and pure noise on a phone, so they stay in --status
# alone. Everything else is the same helpers on the same arguments,
# computed by the same loop, so the two reports cannot drift apart.
STATUS_BRIEF_SEEN=0
status_brief_report() { # <name> <enabled> <every> <last> <due_at> <now>
  local name="$1" enabled="$2" every="$3" last="$4" due_at="$5" now="$6"
  local lock="$STATE_DIR/$name.lock"
  # A blank line BETWEEN blocks rather than after each: a trailing blank
  # is a wasted last line in the chat bubble.
  [ "$STATUS_BRIEF_SEEN" -eq 0 ] || echo
  STATUS_BRIEF_SEEN=1
  if [ "$enabled" != "true" ]; then
    echo "💤 $name · disabled"
  else
    echo "🤖 $name · every $every"
  fi
  if [ "$last" -eq 0 ]; then
    echo "  last: never"
  else
    echo "  last: $(fmt_duration $((now - last))) ago"
  fi
  # A disabled agent has no next run to report, so the line is dropped
  # rather than spent on an "n/a" that says nothing.
  if [ "$enabled" = "true" ]; then
    if [ "$last" -eq 0 ]; then
      echo "  next: now"
    elif [ "$due_at" -gt "$now" ]; then
      echo "  next: in $(fmt_duration $((due_at - now)))"
    else
      echo "  ⚠️ overdue by $(fmt_duration $((now - due_at)))"
    fi
  fi
  # The same read-only open status_report uses, so a status reply never
  # creates a lock file as a side effect. Printed only when the lock is
  # held: "free" is the normal state, and a line saying so is a line to
  # skip past on every reply.
  if [ -e "$lock" ] && ! (flock -n 9) 9<"$lock"; then
    echo "  🔒 running now"
  fi
  echo "  💰 $(usage_summary "$name")"
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

# A session can die mid-line — claude prints its usage-limit message with
# no trailing newline — so everything the dispatcher appends to a log has
# to open its own line first. Without that the message and whatever
# follows it merge into one unmatchable line (#322). Every append below
# goes through this rather than repeating the guard.
end_line() { # end_line <file> — a newline unless <file> is empty or ends in one
  if [ -s "$1" ] && [ -n "$(tail -c1 "$1")" ]; then echo >>"$1"; fi
}

# shellcheck disable=SC2329  # invoked from launch()'s EXIT trap
tick_trailer() { # tick_trailer <log> <code> — the last line of every run log
  local log="$1" code="$2"
  end_line "$log"
  echo "tick exited $code" >>"$log"
}

# The session's stdout is claude's single JSON result object
# (--output-format json): the same final text a plain `-p` prints, as
# `.result`, plus `usage`, per-model `modelUsage` (tokens and costUSD),
# `total_cost_usd`, `num_turns` and `duration_ms`. This folds it back into
# the log so the log reads as before — the result text, then one
# "usage:" line and one "usage <model>:" line per model — and keeps the
# raw object under $STATE_DIR/usage/ as the dataset a cost review reads.
# Anything that is not that object (a usage-limit message, a crash, a
# claude too old for the flag) goes into the log verbatim with a
# "usage: unavailable" line, and no usage record is written: a record
# that cannot be summed is worse than a gap. Needs jq; without it the raw
# output is kept verbatim in the log too, so nothing is ever lost.
record_usage() { # record_usage <name> <stamp> <raw-stdout-file> <log>
  local name="$1" stamp="$2" raw="$3" log="$4"
  local record="$STATE_DIR/usage/$name-$stamp.json"
  # stderr streamed into the log live and may have ended mid-line too.
  end_line "$log"
  if [ ! -s "$raw" ]; then
    echo "usage: unavailable (session printed nothing)" >>"$log"
    return 0
  fi
  if ! command -v "$JQ_BIN" >/dev/null 2>&1; then
    cat "$raw" >>"$log"
    end_line "$log"
    echo "usage: unavailable (jq not installed; raw output above)" >>"$log"
    return 0
  fi
  if ! "$JQ_BIN" -e 'type == "object" and has("result") and has("usage")' \
    "$raw" >/dev/null 2>&1
  then
    cat "$raw" >>"$log"
    end_line "$log"
    echo "usage: unavailable (session output was not a result object)" \
      >>"$log"
    return 0
  fi
  "$JQ_BIN" -r '.result // ""' "$raw" >>"$log"
  "$JQ_BIN" -r '
    def n(x): x // 0;
    "usage: cost_usd=\(n(.total_cost_usd)) turns=\(n(.num_turns)) " +
    "duration_s=\((n(.duration_ms) / 1000) | floor) " +
    "input=\(n(.usage.input_tokens)) output=\(n(.usage.output_tokens)) " +
    "cache_read=\(n(.usage.cache_read_input_tokens)) " +
    "cache_create=\(n(.usage.cache_creation_input_tokens)) " +
    "error=\(.is_error // false)",
    ((.modelUsage // {}) | to_entries[] |
      "usage \(.key): cost_usd=\(n(.value.costUSD)) " +
      "input=\(n(.value.inputTokens)) output=\(n(.value.outputTokens)) " +
      "cache_read=\(n(.value.cacheReadInputTokens)) " +
      "cache_create=\(n(.value.cacheCreationInputTokens))")
  ' "$raw" >>"$log"
  cp "$raw" "$record"
}

# "12 runs, $38.20 total, $3.18 mean (180d)" from the usage records, or
# why there is nothing to sum.
usage_summary() { # usage_summary <name>
  local name="$1" files=()
  while IFS= read -r f; do files+=("$f"); done < <(
    find "$STATE_DIR/usage" -maxdepth 1 -type f -name "$name-*.json" \
      2>/dev/null | sort)
  if [ "${#files[@]}" -eq 0 ]; then
    echo "(no usage records yet)"
    return 0
  fi
  if ! command -v "$JQ_BIN" >/dev/null 2>&1; then
    echo "(${#files[@]} records; jq needed to sum them)"
    return 0
  fi
  # shellcheck disable=SC2016  # jq program: $days comes from --arg, not bash
  "$JQ_BIN" -rs --arg days "$USAGE_RETENTION_DAYS" '
    map(.total_cost_usd // 0) |
    "\(length) runs, $\(add * 100 | round / 100) total, " +
    "$\(add / length * 100 | round / 100) mean (\($days)d)"
  ' "${files[@]}"
}

# Alerts go out at most once per condition per ALERT_INTERVAL. A usage
# limit kills three or four consecutive ticks and a hung lock is still
# hung on the next poll: without the stamp the phone buzzes on every
# tick, and an alert channel that cries wolf is one that gets muted,
# which costs more than sending nothing would have.
send_alert() { # send_alert <condition> <message>
  local condition="$1" message="$2" id=""
  local stamp="$STATE_DIR/alerts/$condition.stamp"
  # Parsed on first use rather than in the config block: interval_seconds
  # is defined further down the file.
  if [ -z "${ALERT_SECS:-}" ]; then
    ALERT_SECS="$(interval_seconds "$ALERT_INTERVAL" 2>/dev/null)" || {
      echo "unusable KARI_TELEGRAM_ALERT_INTERVAL '$ALERT_INTERVAL'" \
        "(want Nm/Nh/Nd, e.g. 4h); using 4h" >&2
      ALERT_SECS=14400
    }
  fi
  if [ -e "$stamp" ]; then
    local age=$(($(date +%s) - $(stat -c %Y "$stamp")))
    [ "$age" -lt "$ALERT_SECS" ] && return 0
  fi
  id="$("$TELEGRAM_BIN" send "$message")" || true
  # Only a delivered message starts the rate-limit window. An
  # unconfigured transport prints nothing at all, and stamping on that
  # would swallow the first REAL alert after the token is finally set up
  # — the one message the setup exists to receive.
  [ -n "$id" ] && touch "$stamp"
  return 0
}

# Failures the fleet cannot report on its own: the session that was
# killed is in no position to send a message about being killed. Reads
# the "tick exited <code>" trailer every run log ends in (see
# tick_trailer) for logs written since the last scan.
telegram_alerts() {
  mkdir -p "$STATE_DIR/alerts"
  local stamp="$STATE_DIR/alerts/last-scan"
  local marker="$STATE_DIR/alerts/last-scan.tmp"
  # Stamped BEFORE the scan, so a log finished while the scan runs is not
  # skipped; see the mv below for the cost of that choice.
  touch "$marker"
  # The first scan is baseline only: a freshly configured transport must
  # not open with 30 days of relitigated history in one buzz.
  if [ ! -e "$stamp" ]; then
    mv "$marker" "$stamp"
    return 0
  fi
  local f last base msg limited=() failed=()
  for f in "$STATE_DIR/logs"/*.log; do
    [ -e "$f" ] || continue
    [ "$f" -nt "$stamp" ] || continue
    last="$(tail -n 1 "$f" 2>/dev/null || true)"
    case "$last" in
      "tick exited 0") continue ;;
      "tick exited "*) ;;
      # No trailer at all: still running, or SIGKILLed (an OOM). Neither
      # is classifiable here, and telegram_lock_alerts covers the hang.
      *) continue ;;
    esac
    base="$(basename "$f" .log)"
    # Matched on the stable shape, not the exact wording: #322 recorded
    # this as "You've hit your monthly spend limit" and today it reads
    # "You've reached your Fable 5 limit". The wording has changed once
    # already; "hit/reached your ... limit" has not.
    if grep -qiE '(hit|reached) your .*limit' "$f"; then
      limited+=("$base")
    else
      failed+=("$base")
    fi
  done
  # A log that completed between the marker and here is seen by this scan
  # and by the next one. That repeat is deliberate: the per-condition
  # stamp above absorbs it, whereas stamping afterwards would drop the
  # log entirely, and a missed alert is the expensive failure.
  mv "$marker" "$stamp"
  # One log name per line rather than a run-on list: on a phone, four
  # logs on one line is a wall of wrapped filenames nobody reads to the
  # end of. printf does the joining, and the command substitution drops
  # the trailing newline so the message never ends in a blank line.
  if [ "${#limited[@]}" -gt 0 ]; then
    msg="🚨💸 automation: usage/spend limit killed ${#limited[@]} tick(s):"
    send_alert usage-limit "$(printf '%s\n' "$msg" "${limited[@]}")"
  fi
  if [ "${#failed[@]}" -gt 0 ]; then
    msg="🚨 automation: ${#failed[@]} tick(s) exited non-zero:"
    send_alert tick-failed "$(printf '%s\n' "$msg" "${failed[@]}")"
  fi
}

# The other half of "did the fleet die quietly": a tick that is neither
# finished nor killed, just wedged. Its lock is still held and its log
# has no trailer, so nothing above can see it — the lock is the signal.
telegram_lock_alerts() {
  local lock name last now elapsed ceiling msg
  now="$(date +%s)"
  ceiling=$((BG_WAIT_CEILING_MS / 1000 + LOCK_ALERT_SLACK))
  for lock in "$STATE_DIR"/*.lock; do
    [ -e "$lock" ] || continue
    # The same read-only probe status_report uses, so checking never
    # creates a lock file or takes a lock of its own. Wrapped in `if`
    # rather than `&& continue` because a failing && list would trip
    # set -e and end the tick.
    if (flock -n 9) 9<"$lock"; then continue; fi
    name="$(basename "$lock" .lock)"
    last=0
    [ -f "$STATE_DIR/$name.last-run" ] &&
      last="$(cat "$STATE_DIR/$name.last-run")"
    # A lock with no readable last-run is a lock this dispatcher never
    # stamped; there is no age to judge it by.
    [[ "$last" =~ ^[1-9][0-9]*$ ]] || continue
    elapsed=$((now - last))
    if [ "$elapsed" -gt "$ceiling" ]; then
      msg="🚨🔒 automation: $name has held its lock for"
      send_alert "lock-$name" \
        "$msg $(fmt_duration "$elapsed") — the run may be hung"
    fi
  done
}

# A usage limit is the one failure worth immediately re-running on the
# other model. `--fallback-model` covers capacity/overload errors only, so
# quota exhaustion exits the session without ever trying the fallback --
# `fallback: opus` promised "keep orchestrating on Opus when the Fable
# limit is hit" and never once did it (#515). Everything else stays
# un-retried: a timed-out tick (api_error_status null, 2026-08-24 16:00)
# and a CLI that segfaults before printing anything (2.1.243, which cost
# three ticks on 2026-08-25) must not be multiplied.
# Keyed on the status code, NOT the message: #322 recorded this same
# failure as "You've hit your monthly spend limit" and today it reads
# "You've reached your Fable 5 limit". The wording has already changed
# once; 429 has not. Anything unreadable -- no jq, empty output, output
# that is not a result object, a garbage cost limit -- fails the jq test
# and means "do not retry", so the fail-safe is always the cheap one.
retry_on_fallback() { # <rc> <raw> <model> <fallback> — exit 0 = do retry
  local rc="$1" raw="$2" model="$3" fallback="$4"
  [ "$rc" -ne 0 ] || return 1
  [ -n "$fallback" ] && [ "$fallback" != "$model" ] || return 1
  [ -s "$raw" ] || return 1
  command -v "$JQ_BIN" >/dev/null 2>&1 || return 1
  # Failing at session start costs ~2s and $0, which is the case that
  # recurs for the rest of a quota period; a limit hit deep into a tick
  # has already paid for that work, and re-running bills it twice with
  # the next tick only a cadence away.
  # shellcheck disable=SC2016  # jq program: $limit comes from --argjson
  "$JQ_BIN" -e --argjson limit "$RETRY_COST_LIMIT" '
    (.api_error_status? == 429) and ((.total_cost_usd // 0) <= $limit)
  ' "$raw" >/dev/null 2>&1
}

launch() { # launch <name> <model> <fallback> <agent-file> — backgrounded
  local name="$1" model="$2" fallback="$3" agent_file="$4"
  local stamp log raw
  stamp="$(date +%Y%m%dT%H%M%S)"
  log="$STATE_DIR/logs/$name-$stamp.log"
  raw="$log.stdout"
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
    # Probed once, but the unit is named per attempt below: a retry
    # reusing $stamp would collide with a first scope not yet reaped.
    local scope_ok=0
    if command -v "$SYSTEMD_RUN_BIN" >/dev/null 2>&1; then
      if "$SYSTEMD_RUN_BIN" --user --scope --quiet -- true >/dev/null 2>&1
      then
        scope_ok=1
        # OOMPolicy: systemd's default for a scope is `stop`, which turned
        # one OOM-killed vitest worker into the death of the whole tick
        # (2026-08-21, #412) -- the opposite of what the scope is for.
        # `continue` lets the kernel take the one process and the session
        # carry on. MemoryMax keeps that kill inside the scope's own
        # cgroup: a runaway then OOMs against the cap and the kernel
        # picks the biggest process in the scope, not whatever it finds
        # on the host. Half the machine leaves the desktop breathing
        # room on a host with no swap.
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
    # stdout is the JSON result object (one write, at the end); stderr
    # keeps streaming into the log as before, so warnings and a
    # usage-limit message land there live. record_usage then folds the
    # result text and a usage line into the log. The .stdout sidecar is
    # removed once folded in -- a sidecar left behind means the session
    # died before record_usage ran.
    # At most two passes: the configured model, then the fallback if the
    # first died on a usage limit (see retry_on_fallback). $suffix is both
    # the "have we already retried?" flag and what keeps the second
    # attempt's scope unit and usage record from overwriting the first's.
    local rc=0 try_model="$model" try_fallback="$fallback" suffix="" msg=""
    while :; do
      local scope=() unit=""
      if [ "$scope_ok" = 1 ]; then
        unit="kari-agent-$name-$stamp$suffix"
        scope=("$SYSTEMD_RUN_BIN" --user --scope --quiet --unit="$unit"
          --property=OOMPolicy=continue --property="MemoryMax=$MEMORY_MAX" --)
      fi
      rc=0
      # shellcheck disable=SC2086
      prompt_body "$agent_file" |
        CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS="$BG_WAIT_CEILING_MS" \
        CI=true \
        "${scope[@]}" "${inhibit[@]}" "$CLAUDE_BIN" -p \
          --dangerously-skip-permissions \
          --output-format json \
          ${try_model:+--model "$try_model"} \
          ${try_fallback:+--fallback-model "$try_fallback"} \
          >"$raw" 2>>"$log" || rc=$?
      record_usage "$name" "$stamp$suffix" "$raw" "$log"
      # Only a scope that still has processes in it is "stopped"; an empty
      # one was already collected, and a session that cleaned up after
      # itself deserves a quiet exit. Reaped per attempt so a retry never
      # inherits the debris of the attempt before it.
      if [ -n "$unit" ] &&
        "$SYSTEMCTL_BIN" --user is-active --quiet "$unit.scope" 2>/dev/null
      then
        echo "reap $name: stopping leftover processes in $unit.scope"
        "$SYSTEMCTL_BIN" --user stop "$unit.scope" 2>/dev/null || true
      fi
      if [ -n "$suffix" ] ||
        ! retry_on_fallback "$rc" "$raw" "$model" "$fallback"
      then
        break
      fi
      # Both destinations on purpose: the journal is where a human
      # notices, the log is what the next tick and claim-liveness read.
      msg="retry $name: $try_model hit a usage limit; retrying on $fallback"
      echo "$msg"
      end_line "$log"
      echo "$msg" >>"$log"
      rm -f "$raw"
      suffix="-retry"
      try_model="$fallback"
      # Already running as the fallback; passing it again would make the
      # session its own fallback.
      try_fallback=""
    done
    rm -f "$raw"
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

mkdir -p "$STATE_DIR/logs" "$STATE_DIR/usage"

# Deliberately ABOVE the pause gate: /resume arrives over Telegram, and a
# paused fleet that cannot hear it would stay paused until someone walked
# back to the laptop. `|| echo` because a transport failure must never
# fail a tick — an unreachable phone is not a reason to skip the work.
# Diagnostics never poll: --dry-run and --status must leave the inbox
# (and every side effect a message has) exactly as they found it.
if [ "$MODE" = run ]; then
  "$TELEGRAM_BIN" poll || echo "warn: telegram poll failed (rc=$?)" >&2
fi

if [ -e "$PAUSE_FILE" ]; then
  case "$MODE" in
    status) echo "fleet paused ($PAUSE_FILE exists) — nothing will launch" ;;
    # Both status modes report the agents anyway: paused is the moment
    # you most want to know what the fleet will do once it resumes.
    status-brief)
      echo "⏸️ fleet PAUSED — remove the pause file to resume"
      echo
      ;;
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

# Initialised unconditionally so the diagnostics below read a real value
# rather than tripping set -u.
NUDGE=false

# Only a real tick updates: --dry-run and --status are diagnostics and
# must not change the tree under the operator reading them — which
# includes consuming the nudge the next real tick is owed.
if [ "$MODE" = run ]; then
  self_update
  telegram_alerts
  telegram_lock_alerts
  # A reply from the phone means the maintainer just unblocked something;
  # sitting out the rest of a 6h cadence wastes the moment. telegram.sh
  # drops this file when it posts a reply to an issue.
  if [ -e "$STATE_DIR/nudge" ]; then
    rm -f "$STATE_DIR/nudge"
    NUDGE=true
    echo "nudge: treating every enabled agent as due"
  fi
fi

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
  if [ "$MODE" = status-brief ]; then
    status_brief_report "$name" "$enabled" "$every" "$last" "$due_at" "$now"
    continue
  fi
  if [ "$enabled" != "true" ]; then
    case "$MODE" in
      dry-run) decision disabled "$name" ;;
      *) echo "skip $name: disabled" ;;
    esac
    continue
  fi
  if [ "$NUDGE" != true ] && [ "$now" -lt "$due_at" ]; then
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
# Usage records outlive logs: they are a few KB each and a cost review
# wants months, not weeks, of history.
find "$STATE_DIR/usage" -type f -mtime +"$USAGE_RETENTION_DAYS" -delete \
  2>/dev/null || true

# --wait: block on every launch (and fail if any did), for manual ticks and
# the test harness; a timer-driven tick exits as soon as they are forked.
status=0
for pid in "${LAUNCHED[@]}"; do
  wait "$pid" || status=1
done
exit "$status"
