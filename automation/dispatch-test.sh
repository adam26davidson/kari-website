#!/usr/bin/env bash
# Test harness for automation/dispatch.sh. Runs in CI (the shell-lint job)
# and locally; run it whenever dispatch.sh changes:
#   bash automation/dispatch-test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCH="$HERE/dispatch.sh"
FAILURES=0
WORKDIRS=()

cleanup() {
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

new_work() {
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/agents" "$work/state"
  WORKDIRS+=("$work")
  echo "$work"
}

write_agent() { # <workdir> <filename> <name> <enabled> <every> <model>
  cat >"$1/agents/$2" <<EOF
---
name: $3
enabled: $4
every: $5
model: $6
---
This is the $3 prompt body.
EOF
}

run_dispatch() { # <workdir> [args...] — output in <workdir>/out
  local work="$1"
  shift
  KARI_AUTOMATION_STATE_DIR="$work/state" \
  KARI_AUTOMATION_AGENTS_DIR="$work/agents" \
  KARI_AUTOMATION_PAUSE_FILE="$work/PAUSE" \
  KARI_AUTOMATION_CLAUDE_BIN="${STUB_CLAUDE:-claude}" \
  KARI_AUTOMATION_DUE_TOLERANCE="${DUE_TOLERANCE:-}" \
  KARI_AUTOMATION_INHIBIT_BIN="${KARI_AUTOMATION_INHIBIT_BIN:-/nonexistent/systemd-inhibit}" \
    bash "$DISPATCH" "$@" >"$work/out" 2>&1
  echo $? >"$work/exit-code"
}

# Real launches are backgrounded and disowned; --wait makes the dispatcher
# block until they finish, so a stub's record is complete when this returns
# (no sleep-polling, which was a latent flake source under load).
run_launch() { # <workdir> — a real (non-dry-run) tick with the stub claude
  STUB_CLAUDE="${STUB_CLAUDE:-$STUB_DIR/claude-stub}" run_dispatch "$1" --wait
}

# --dry-run prints one "<decision>\t<name>\t<detail>" line per agent; tests
# read the decision column rather than matching human-readable copy.
decision_of() { # <workdir> <name> — "" when the agent has no line
  awk -F'\t' -v name="$2" '$2 == name { print $1; exit }' "$1/out"
}

decisions() { # <workdir> — every decision, space-separated
  awk -F'\t' 'NF >= 2 { printf "%s%s", sep, $1; sep = " " }' "$1/out"
}

ran_ago() { # <workdir> <name> <seconds-ago>
  echo "$(($(date +%s) - $3))" >"$1/state/$2.last-run"
}

expect_contains() { # <file> <needle> <test-name>
  if grep -qF -- "$2" "$1" 2>/dev/null; then
    echo "ok: $3"
  else
    echo "FAIL: $3 — no '$2' in $1:"
    sed 's/^/    /' "$1" 2>/dev/null || echo "    (missing file)"
    FAILURES=$((FAILURES + 1))
  fi
}

# A missing file is a failure, not an absence: without this, every
# expect_not_contains would pass for free on a launch that never happened.
expect_not_contains() { # <file> <needle> <test-name>
  if [ ! -e "$1" ]; then
    echo "FAIL: $3 — expected file $1 (cannot assert '$2' is absent)"
    FAILURES=$((FAILURES + 1))
  elif grep -qF -- "$2" "$1" 2>/dev/null; then
    echo "FAIL: $3 — unexpected '$2' in $1"
    FAILURES=$((FAILURES + 1))
  else
    echo "ok: $3"
  fi
}

expect_eq() { # <actual> <expected> <test-name>
  if [ "$1" = "$2" ]; then
    echo "ok: $3"
  else
    echo "FAIL: $3 — expected '$2', got '$1'"
    FAILURES=$((FAILURES + 1))
  fi
}

expect_file() { # <path> <test-name>
  if [ -e "$1" ]; then
    echo "ok: $2"
  else
    echo "FAIL: $2 — expected file $1"
    FAILURES=$((FAILURES + 1))
  fi
}

expect_file_absent() { # <path> <test-name>
  if [ -e "$1" ]; then
    echo "FAIL: $2 — unexpected file $1"
    FAILURES=$((FAILURES + 1))
  else
    echo "ok: $2"
  fi
}

# 1. Enabled agent that has never run is due.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" run \
  "dry-run: never-run enabled agent is due"

# 2. Disabled agent is skipped.
w="$(new_work)"
write_agent "$w" demo-agent.md demo-agent false 1h opus
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" demo-agent)" disabled "disabled agent skipped"

# 3. Agent that ran 60s ago with every: 1h is not due.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" not-due \
  "recently-run agent is not due"

# 4. Agent that ran 2h ago with every: 1h is due again.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 7200
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" run \
  "agent past its interval is due"

# 4a. Drift guard (#276): a run that started slightly inside the polling
#     window must not push the next run a whole poll later. With the
#     default 120s tolerance, "interval - 60s" counts as due...
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline $((3600 - 60))
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" run \
  "agent within the due tolerance is due"

# 4b. ...while "interval - (tolerance + 60s)" is still not due.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline $((3600 - (120 + 60)))
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" not-due \
  "agent outside the due tolerance is not due"

# 4c. The tolerance is configurable: a widened one makes an agent due
#     that the default tolerance would have skipped.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 1800
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" not-due \
  "half-elapsed agent not due by default"
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 1800
DUE_TOLERANCE=2400 run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" run \
  "due tolerance is configurable"

# 4d. A tolerance wider than the interval never makes an agent overdue
#     forever: an agent that just ran with every: 5m is still due (the
#     tolerance clamps to the interval), not an error.
w="$(new_work)"
write_agent "$w" fast-agent.md fast-agent true 5m opus
ran_ago "$w" fast-agent 1
DUE_TOLERANCE=3600 run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" fast-agent)" run \
  "tolerance larger than the interval clamps instead of underflowing"
expect_eq "$(cat "$w/exit-code")" 0 "oversized tolerance exits 0"

# 4e. A tolerance that isn't a plain decimal integer (e.g. the Nm/Nh
#     duration syntax `every` uses, or a leading-zero value bash would
#     read as octal) must not take the fleet down silently: warn, fall
#     back to the 120s default, and keep dispatching.
#     The agent last ran "interval - 100s" ago, which is inside the 120s
#     default but outside octal readings of the leading-zero values (090
#     is a base error, 0120 is 80s), so a value that slipped through
#     validation shows up here as a missing launch rather than passing by
#     luck.
for bad_tolerance in 120s 2m "" abc -60 090 0120; do
  w="$(new_work)"
  write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
  ran_ago "$w" issue-pipeline $((3600 - 100))
  DUE_TOLERANCE="$bad_tolerance" run_dispatch "$w" --dry-run
  expect_eq "$(decision_of "$w" issue-pipeline)" run \
    "tolerance '$bad_tolerance' falls back to the default instead of skipping"
  expect_eq "$(cat "$w/exit-code")" 0 "tolerance '$bad_tolerance' exits 0"
done
# The bogus value is named on stderr so the misconfiguration is visible.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline $((3600 - 60))
DUE_TOLERANCE=120s run_dispatch "$w" --dry-run
expect_contains "$w/out" "KARI_AUTOMATION_DUE_TOLERANCE" \
  "bad tolerance is reported"

# 5. PAUSE file halts the whole fleet.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
touch "$w/PAUSE"
run_dispatch "$w" --dry-run
expect_eq "$(decisions "$w")" paused "PAUSE file is the only decision"
expect_eq "$(decision_of "$w" issue-pipeline)" "" \
  "PAUSE file prevents launches"

# 6. Agent file missing required frontmatter warns but doesn't fail the run.
w="$(new_work)"
write_agent "$w" good.md good-agent true 1h opus
cat >"$w/agents/broken.md" <<'EOF'
---
enabled: true
---
body with no name or interval
EOF
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" broken.md)" invalid "broken agent file reported"
expect_eq "$(decision_of "$w" good-agent)" run \
  "other agents still processed after a broken file"
expect_eq "$(cat "$w/exit-code")" 0 "broken agent file exits 0"

# 7. Real launch: stub claude receives flags and the frontmatter-stripped
#    body; last-run and a log file are recorded.
STUB_DIR="$(mktemp -d)"
WORKDIRS+=("$STUB_DIR")
cat >"$STUB_DIR/claude-stub" <<'EOF'
#!/usr/bin/env bash
{
  echo "ARGS: $*"
  echo "STDIN:"
  cat
} >"$STUB_OUT"
EOF
chmod +x "$STUB_DIR/claude-stub"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
run_launch "$w"
expect_contains "$w/stub-out" "--dangerously-skip-permissions" \
  "launch passes --dangerously-skip-permissions"
expect_contains "$w/stub-out" "--model fable" "launch passes the model"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "launch pipes the prompt body"
expect_not_contains "$w/stub-out" "name: issue-pipeline" \
  "frontmatter is stripped from the prompt"
expect_file "$w/state/issue-pipeline.last-run" "last-run recorded"
expect_eq \
  "$(find "$w/state/logs" -name 'issue-pipeline-*.log' 2>/dev/null | wc -l)" \
  1 "one log file created"

# 8. Immediately after a real run, the agent is no longer due.
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" not-due \
  "agent not due right after a run"

# 9. Optional fallback frontmatter becomes --fallback-model; absent when unset.
w="$(new_work)"
cat >"$w/agents/issue-pipeline.md" <<'EOF'
---
name: issue-pipeline
enabled: true
every: 1h
model: fable
fallback: opus
---
This is the issue-pipeline prompt body.
EOF
export STUB_OUT="$w/stub-out"
run_launch "$w"
expect_contains "$w/stub-out" "--fallback-model opus" \
  "launch passes the fallback model when configured"

w="$(new_work)"
write_agent "$w" no-fallback.md no-fallback true 1h opus
export STUB_OUT="$w/stub-out"
run_launch "$w"
expect_not_contains "$w/stub-out" "--fallback-model" \
  "no fallback flag when frontmatter omits it"

# Sleep inhibition: the agent runs under systemd-inhibit when available, so a
# tick can never be suspended mid-flight (see the overnight suspend incident).
STUB_INHIBIT="$STUB_DIR/inhibit-stub"
cat >"$STUB_INHIBIT" <<'EOF'
#!/usr/bin/env bash
# Records its own flags, then runs the wrapped command so the launch still works.
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --*) args+=("$1"); shift ;;
    *) break ;;
  esac
done
echo "INHIBIT_FLAGS: ${args[*]}" >"$STUB_OUT.inhibit"
exec "$@"
EOF
chmod +x "$STUB_INHIBIT"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_INHIBIT_BIN="$STUB_INHIBIT" run_launch "$w"
expect_contains "$w/stub-out.inhibit" "--what=sleep:idle" \
  "launch runs under a sleep+idle inhibitor"
expect_contains "$w/stub-out.inhibit" "--mode=block" \
  "inhibitor blocks rather than delays"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "agent still receives its prompt through the inhibitor"

# The inhibitor is optional: an unavailable binary must not stop the tick.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_INHIBIT_BIN="/nonexistent/systemd-inhibit" run_launch "$w"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "agent still launches when no inhibitor binary exists"

# ...and "optional" has to mean present-but-unusable too. systemd-inhibit
# exists on any systemd host, including headless ones and CI runners, but
# exits non-zero when there is no logind/D-Bus session to take the lock
# from. Wrapping the launch in it unconditionally would then kill the tick
# outright — losing the run to protect it from a suspend that cannot happen.
STUB_BROKEN_INHIBIT="$STUB_DIR/inhibit-broken-stub"
cat >"$STUB_BROKEN_INHIBIT" <<'EOF'
#!/usr/bin/env bash
echo "Failed to connect to bus: No medium found" >&2
exit 1
EOF
chmod +x "$STUB_BROKEN_INHIBIT"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_INHIBIT_BIN="$STUB_BROKEN_INHIBIT" run_launch "$w"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "agent still launches when the inhibitor cannot take a lock"

# 10. Unknown flags are rejected rather than silently treated as a real tick.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
run_dispatch "$w" --bogus
expect_eq "$(cat "$w/exit-code")" 2 "unknown flag exits 2"
expect_file_absent "$w/state/issue-pipeline.last-run" \
  "unknown flag launches nothing"

# 11. --status (#292): per-agent last-run, next-due (tolerance included),
#     lock state, and the observed inter-run gaps. Gaps come from the
#     per-run log filenames, which already form a 30-day run history.
log_at() { # <workdir> <name> <YYYYmmddTHHMMSS>
  touch "$1/state/logs/$2-$3.log"
}
status_line() { # <workdir> <name> <field> — the field's value for the agent
  awk -v name="$2" -v field="$3" '
    /^[^ ]/ { current = $1 }
    current == name && $1 == field":" { sub(/^[^:]*:[[:space:]]*/, ""); print }
  ' "$1/out"
}
w="$(new_work)"
mkdir -p "$w/state/logs"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
write_agent "$w" demo-agent.md demo-agent false 2h opus
write_agent "$w" fresh-agent.md fresh-agent true 30m opus
ran_ago "$w" issue-pipeline 600
log_at "$w" issue-pipeline 20260821T080000
log_at "$w" issue-pipeline 20260821T090000
log_at "$w" issue-pipeline 20260821T101500
log_at "$w" issue-pipeline 20260821T111000
log_at "$w" issue-pipelines 20260821T120000 # another agent's log, not ours
run_dispatch "$w" --status
expect_eq "$(cat "$w/exit-code")" 0 "status exits 0"
last_epoch="$(cat "$w/state/issue-pipeline.last-run")"
expect_contains "$w/out" \
  "$(date -d "@$last_epoch" '+%Y-%m-%d %H:%M:%S')" "status shows last run"
expect_contains "$w/out" \
  "$(date -d "@$((last_epoch + 3600 - 120))" '+%Y-%m-%d %H:%M:%S')" \
  "status shows next-due including the tolerance"
expect_eq "$(status_line "$w" issue-pipeline gaps)" \
  "1h00m 1h15m 55m00s (4 runs logged, mean 1h03m)" \
  "status lists the observed inter-run gaps oldest first"
expect_eq "$(status_line "$w" issue-pipeline lock)" free \
  "status reports a free lock"
expect_eq "$(status_line "$w" fresh-agent last-run)" never \
  "status shows never-run agents"
expect_eq "$(status_line "$w" fresh-agent next-due)" now \
  "never-run agents are due now"
expect_eq "$(status_line "$w" fresh-agent gaps)" "(no runs logged)" \
  "never-run agents have no gaps"
expect_eq "$(status_line "$w" demo-agent next-due)" "n/a (disabled)" \
  "disabled agents have no next-due"
expect_file_absent "$w/state/fresh-agent.last-run" \
  "status launches nothing"

# 11d. Long histories are summarised: only the newest 12 gaps are listed,
#      while the run count and mean still cover every logged run.
w="$(new_work)"
mkdir -p "$w/state/logs"
write_agent "$w" fast-agent.md fast-agent true 30m opus
for i in $(seq 0 14); do
  log_at "$w" fast-agent "$(printf '20260821T%02d0000' "$i")"
done
log_at "$w" fast-agent 20260821T153000
run_dispatch "$w" --status
eleven_hours="$(printf '1h00m %.0s' $(seq 11))"
expect_eq "$(status_line "$w" fast-agent gaps)" \
  "${eleven_hours}1h30m (16 runs logged, showing last 12, mean 1h02m)" \
  "status caps the listed gaps at the newest 12"

# 11a. A held lock (a run still in progress) is reported as such.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 600
( flock 9 && run_dispatch "$w" --status ) 9>"$w/state/issue-pipeline.lock"
expect_eq "$(status_line "$w" issue-pipeline lock)" \
  "held (run in progress)" "status reports a held lock"

# 11b. A lapsed agent: next-due is in the past and flagged overdue.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 7200
run_dispatch "$w" --status
expect_contains "$w/out" "overdue" "status flags an overdue agent"

# 11c. --status still reports while the fleet is paused, and says so.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
touch "$w/PAUSE"
run_dispatch "$w" --status
expect_contains "$w/out" "paused" "status mentions the PAUSE file"
expect_eq "$(status_line "$w" issue-pipeline last-run)" never \
  "status still lists agents while paused"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) FAILED"
  exit 1
fi
echo "all tests passed"
