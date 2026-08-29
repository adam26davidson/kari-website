#!/usr/bin/env bash
# Test harness for automation/dispatch.sh. Runs in CI (the shell-lint job)
# and locally; run it whenever dispatch.sh changes:
#   bash automation/dispatch-test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCH="$HERE/dispatch.sh"
LIVENESS="$HERE/claim-liveness.sh"
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

# The claude binary run_dispatch uses unless a test opts in to a stub.
# It used to default to the REAL `claude`, on the theory that the
# launch-free tests (--dry-run, --status, bad flags) never reach a
# launch — which is the very property those tests exist to verify. When a
# launch path regressed, the harness therefore ran a real
# `claude -p --dangerously-skip-permissions` in this checkout, detached,
# with its log inside a temp dir the cleanup trap then deleted. That is
# not hypothetical: it is how #374 was filed, and re-regressing the
# --status parse today still spawns six of them.
# So the unsafe path is now the one you have to opt into. Anything that
# reaches a launch without naming a stub hits this instead: it records
# the invocation, says so on stderr (which dispatch.sh streams into the
# run log), and exits non-zero so --wait reports a failure too.
TRIPWIRE_DIR="$(mktemp -d)"
WORKDIRS+=("$TRIPWIRE_DIR")
TRIPWIRE_CLAUDE="$TRIPWIRE_DIR/claude-tripwire"
TRIPWIRE_RECORD="$TRIPWIRE_DIR/launches"
: >"$TRIPWIRE_RECORD"
# Unquoted heredoc on purpose: the record path is baked in, so the
# tripwire does not depend on an env var surviving the launch.
cat >"$TRIPWIRE_CLAUDE" <<EOF
#!/usr/bin/env bash
cat >/dev/null
echo "UNEXPECTED LAUNCH: \$* (cwd=\$PWD)" >>"$TRIPWIRE_RECORD"
echo "dispatch-test.sh tripwire: a real launch was reached" >&2
exit 97
EOF
chmod +x "$TRIPWIRE_CLAUDE"

# The telegram transport run_dispatch uses unless a test opts into the
# recording stub below. Two hazards it closes at once: the real
# telegram.sh prints its "transport disabled" warning into every test's
# captured output, and on the maintainer's own laptop — where the token
# IS exported — an unstubbed harness would message their phone on every
# run. The env block in run_dispatch blanks the two secrets for the same
# reason, so even a leaked token reaches nothing.
QUIET_TELEGRAM="$TRIPWIRE_DIR/telegram-quiet"
cat >"$QUIET_TELEGRAM" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$QUIET_TELEGRAM"

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
  KARI_AUTOMATION_CLAUDE_BIN="${STUB_CLAUDE:-$TRIPWIRE_CLAUDE}" \
  KARI_AUTOMATION_JQ_BIN="${STUB_JQ:-jq}" \
  KARI_AUTOMATION_DUE_TOLERANCE="${DUE_TOLERANCE:-}" \
  KARI_AUTOMATION_INHIBIT_BIN="${KARI_AUTOMATION_INHIBIT_BIN:-/nonexistent/systemd-inhibit}" \
  KARI_AUTOMATION_SYSTEMD_RUN_BIN="${KARI_AUTOMATION_SYSTEMD_RUN_BIN:-/nonexistent/systemd-run}" \
  KARI_AUTOMATION_SYSTEMCTL_BIN="${KARI_AUTOMATION_SYSTEMCTL_BIN:-/nonexistent/systemctl}" \
  KARI_AUTOMATION_SELF_UPDATE="${SELF_UPDATE:-0}" \
  KARI_TELEGRAM_BOT_TOKEN='' KARI_TELEGRAM_CHAT_ID='' \
  KARI_AUTOMATION_TELEGRAM_BIN="${STUB_TELEGRAM:-$QUIET_TELEGRAM}" \
  KARI_AUTOMATION_LOCK_ALERT_SLACK="${KARI_AUTOMATION_LOCK_ALERT_SLACK:-1800}" \
  KARI_AUTOMATION_BG_WAIT_CEILING_MS="${KARI_AUTOMATION_BG_WAIT_CEILING_MS:-5400000}" \
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

# Asserts launch-free-ness positively, rather than inferring it from the
# absence of a .last-run file: the tripwire above records every launch no
# test asked for, so this reads that record and clears it, leaving each
# check independent of the ones before it.
expect_no_launch() { # <test-name>
  if [ -s "$TRIPWIRE_RECORD" ]; then
    echo "FAIL: $1 — the dispatcher reached a real launch:"
    sed 's/^/    /' "$TRIPWIRE_RECORD"
    FAILURES=$((FAILURES + 1))
    : >"$TRIPWIRE_RECORD"
  else
    echo "ok: $1"
  fi
}

# 1. Enabled agent that has never run is due.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" run \
  "dry-run: never-run enabled agent is due"
expect_no_launch "dry-run launches nothing"

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
expect_no_launch "a paused fleet launches nothing"

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
  echo "BG_WAIT_CEILING_MS: ${CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS-unset}"
  echo "CI: ${CI-unset}"
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
# claude -p terminates background subagents 600s after the main turn ends
# unless told otherwise; a worker needs 20-40 minutes (#403).
expect_contains "$w/stub-out" "BG_WAIT_CEILING_MS: 5400000" \
  "launch raises claude's background-task wait ceiling to 90 minutes"
# CI=true makes vitest (and most tooling) run once and non-interactive:
# a session that left vitest in watch mode grew its workers to V8's heap
# cap and OOMed the host (#415).
expect_contains "$w/stub-out" "CI: true" \
  "launch runs the session with CI=true so tooling never enters watch mode"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_BG_WAIT_CEILING_MS=0 run_launch "$w"
expect_contains "$w/stub-out" "BG_WAIT_CEILING_MS: 0" \
  "KARI_AUTOMATION_BG_WAIT_CEILING_MS overrides the ceiling"
expect_eq \
  "$(find "$w/state/logs" -name 'issue-pipeline-*.log' 2>/dev/null | wc -l)" \
  1 "one log file created"
expect_eq "$(cat "$w/exit-code")" 0 "--wait exits 0 when every agent succeeds"

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

# 9b. Usage-limit retry (#515). --fallback-model only covers capacity
#     errors, so a quota-exhausted session exits 1 without ever trying the
#     fallback — `fallback: opus` promised "keep orchestrating on Opus
#     when the Fable limit is hit" and never did it. dispatch.sh now
#     retries the tick once on the fallback model.
#     Keyed on the result object's api_error_status, NOT on the message:
#     #322 recorded this same failure as "You've hit your monthly spend
#     limit" and it reads "You've reached your Fable 5 limit" today. The
#     wording has already changed once; the status code has not.
#     The stubs append one INVOKED line per attempt (sequential within a
#     launch, so no interleaving) and emit the result-object shape
#     record_usage insists on.
STUB_LIMIT="$STUB_DIR/claude-limit-stub"
cat >"$STUB_LIMIT" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "INVOKED: $*" >>"$STUB_OUT"
case "$*" in
  *"--model opus"*)
    printf '{"type":"result","result":"retry ok","usage":{},'
    printf '"is_error":false,"total_cost_usd":0.5}\n'
    ;;
  *)
    printf '{"type":"result","result":"limit reached","usage":{},'
    printf '"is_error":true,"api_error_status":429,"total_cost_usd":%s}\n' \
      "${STUB_COST:-0.01}"
    exit 1
    ;;
esac
EOF
chmod +x "$STUB_LIMIT"

# The 2026-08-24 16:00 tick's real shape: is_error with a null status. A
# timed-out tick must not be re-run — only the quota case may retry.
STUB_NON429="$STUB_DIR/claude-non429-stub"
cat >"$STUB_NON429" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "INVOKED: $*" >>"$STUB_OUT"
printf '{"type":"result","result":"Request timed out","usage":{},'
printf '"is_error":true,"api_error_status":null,"total_cost_usd":0}\n'
exit 1
EOF
chmod +x "$STUB_NON429"

# The 2.1.243 segfault shape: killed before printing anything, so there is
# no result object to read a status out of.
STUB_SILENT="$STUB_DIR/claude-silent-stub"
cat >"$STUB_SILENT" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "INVOKED: $*" >>"$STUB_OUT"
exit 139
EOF
chmod +x "$STUB_SILENT"

write_fallback_agent() { # <workdir> — model fable, fallback opus
  cat >"$1/agents/issue-pipeline.md" <<'EOF'
---
name: issue-pipeline
enabled: true
every: 1h
model: fable
fallback: opus
---
This is the issue-pipeline prompt body.
EOF
}

attempts_of() { # <workdir> — how many times the stub was invoked
  grep -c '^INVOKED:' "$1/stub-out" 2>/dev/null || true
}

w="$(new_work)"
write_fallback_agent "$w"
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_LIMIT" run_launch "$w"
expect_eq "$(attempts_of "$w")" 2 \
  "a usage-limited session is retried once"
grep '^INVOKED:' "$w/stub-out" | tail -1 >"$w/retry-args"
expect_contains "$w/retry-args" "--model opus" \
  "the retry runs on the fallback model"
# Already running as the fallback: passing it again is noise at best and a
# self-referential fallback at worst.
expect_not_contains "$w/retry-args" "--fallback-model" \
  "the retry drops --fallback-model"
RETRY_LOG="$(find "$w/state/logs" -name 'issue-pipeline-*.log' | head -1)"
expect_contains "$RETRY_LOG" "retry issue-pipeline" \
  "the run log says the tick was retried"
expect_contains "$RETRY_LOG" "tick exited 0" \
  "a retry that succeeds makes the tick succeed"
expect_eq "$(cat "$w/exit-code")" 0 \
  "--wait exits 0 when the retry succeeds"
# Spend is the reason the cost guard below can be trusted, so both
# attempts have to be on the record; usage_summary globs "<name>-*.json".
expect_eq \
  "$(find "$w/state/usage" -name 'issue-pipeline-*.json' | wc -l)" 2 \
  "each attempt keeps its own usage record"

# The retry is bounded at one, and the case that proves it is the one the
# fleet will actually meet: a SPEND cap is account-wide rather than
# per-model, so the fallback is limited too and every attempt returns 429.
# Unbounded, that is an infinite loop inside a backgrounded tick.
# The stub stops claiming a limit after 5 calls so a regression fails this
# assertion on the count instead of hanging the suite forever.
STUB_ALWAYS_LIMITED="$STUB_DIR/claude-always-limited-stub"
cat >"$STUB_ALWAYS_LIMITED" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "INVOKED: $*" >>"$STUB_OUT"
if [ "$(grep -c '^INVOKED:' "$STUB_OUT")" -ge 5 ]; then
  printf '{"type":"result","result":"runaway guard","usage":{},'
  printf '"is_error":true,"api_error_status":null,"total_cost_usd":0}\n'
  exit 1
fi
printf '{"type":"result","result":"limit reached","usage":{},'
printf '"is_error":true,"api_error_status":429,"total_cost_usd":0.01}\n'
exit 1
EOF
chmod +x "$STUB_ALWAYS_LIMITED"

w="$(new_work)"
write_fallback_agent "$w"
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_ALWAYS_LIMITED" run_launch "$w"
expect_eq "$(attempts_of "$w")" 2 \
  "the retry is bounded at one even when the fallback is limited too"
expect_eq "$(cat "$w/exit-code")" 1 \
  "--wait still reports failure when the retry fails too"

w="$(new_work)"
write_fallback_agent "$w"
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_NON429" run_launch "$w"
expect_eq "$(attempts_of "$w")" 1 \
  "a non-429 failure is not retried"

w="$(new_work)"
write_fallback_agent "$w"
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_SILENT" run_launch "$w"
expect_eq "$(attempts_of "$w")" 1 \
  "a session that printed no result object is not retried"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_LIMIT" run_launch "$w"
expect_eq "$(attempts_of "$w")" 1 \
  "no retry when the agent configures no fallback"

# Cost guard. Failing at session start costs ~2s and $0, so that retry is
# free; a limit hit deep into a tick has already paid for the work and
# re-running bills it twice with the next tick only a cadence away.
w="$(new_work)"
write_fallback_agent "$w"
export STUB_OUT="$w/stub-out"
STUB_COST=5 STUB_CLAUDE="$STUB_LIMIT" run_launch "$w"
expect_eq "$(attempts_of "$w")" 1 \
  "no retry once the failed attempt has already spent real money"
unset STUB_COST

w="$(new_work)"
write_fallback_agent "$w"
export STUB_OUT="$w/stub-out"
STUB_COST=5 KARI_AUTOMATION_RETRY_COST_LIMIT=10 \
  STUB_CLAUDE="$STUB_LIMIT" run_launch "$w"
expect_eq "$(attempts_of "$w")" 2 \
  "KARI_AUTOMATION_RETRY_COST_LIMIT raises the cost guard"
unset STUB_COST

# --wait's other half: a tick blocks until its launches finish AND reports
# their failure. A failed agent is otherwise invisible — the launch is
# backgrounded, so without propagating the wait status a manual tick (or the
# fleet's own retry logic) would read a dead run as a clean one.
STUB_FAILING="$STUB_DIR/claude-failing-stub"
cat >"$STUB_FAILING" <<'EOF'
#!/usr/bin/env bash
cat >"$STUB_OUT"
echo "stub claude failing on purpose" >&2
exit 3
EOF
chmod +x "$STUB_FAILING"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_FAILING" run_launch "$w"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "the failing stub really ran"
expect_eq "$(cat "$w/exit-code")" 1 \
  "--wait exits non-zero when a launched agent fails"

# One failure is enough: a tick with a healthy agent alongside a failing one
# still reports failure, and the healthy agent still runs.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
write_agent "$w" demo-agent.md demo-agent true 1h opus
export STUB_OUT="$w/stub-out"
# Per-agent marker files rather than one shared log: the two launches are
# concurrent, so interleaved appends would be the flake this harness avoids.
cat >"$STUB_DIR/claude-mixed-stub" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
case "$*" in
  *"--model opus"*) echo failed >"$STUB_OUT.opus"; exit 4 ;;
  *) echo ran >"$STUB_OUT.fable" ;;
esac
EOF
chmod +x "$STUB_DIR/claude-mixed-stub"
STUB_CLAUDE="$STUB_DIR/claude-mixed-stub" run_launch "$w"
expect_eq "$(cat "$w/exit-code")" 1 \
  "--wait reports failure even when another agent succeeded"
expect_file "$STUB_OUT.opus" "the failing agent ran"
expect_file "$STUB_OUT.fable" \
  "the healthy agent still ran to completion alongside the failing one"

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

# Process containment (#401): the agent runs inside a transient systemd
# scope, and the scope is stopped once claude exits, so everything the
# session spawned and left behind (dev stacks for the visual check, most
# often) dies with its tick instead of piling up in the service cgroup.
STUB_SYSTEMD_RUN="$STUB_DIR/systemd-run-stub"
cat >"$STUB_SYSTEMD_RUN" <<'EOF'
#!/usr/bin/env bash
# Records its flags, then runs the wrapped command so the launch still works.
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --) shift; break ;;
    --*) args+=("$1"); shift ;;
    *) break ;;
  esac
done
echo "SCOPE_FLAGS: ${args[*]}" >>"$STUB_OUT.scope"
exec "$@"
EOF
chmod +x "$STUB_SYSTEMD_RUN"
# Answers "active" to is-active (as if the agent left something running)
# and records every call, so the test can see the reap happen.
STUB_SYSTEMCTL="$STUB_DIR/systemctl-stub"
cat >"$STUB_SYSTEMCTL" <<'EOF'
#!/usr/bin/env bash
echo "SYSTEMCTL: $*" >>"$STUB_OUT.systemctl"
exit 0
EOF
chmod +x "$STUB_SYSTEMCTL"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_SYSTEMD_RUN_BIN="$STUB_SYSTEMD_RUN" \
KARI_AUTOMATION_SYSTEMCTL_BIN="$STUB_SYSTEMCTL" run_launch "$w"
expect_contains "$w/stub-out.scope" "--scope" \
  "launch runs inside a transient scope"
expect_contains "$w/stub-out.scope" "--unit=kari-agent-issue-pipeline-" \
  "scope is named after the agent"
# One OOM-killed process must not take the tick with it (#412): systemd's
# default OOMPolicy=stop did exactly that, and a memory cap keeps the
# kill inside the scope's own cgroup instead of wherever the kernel looks.
expect_contains "$w/stub-out.scope" "--property=OOMPolicy=continue" \
  "scope survives an OOM kill of one of its processes"
expect_contains "$w/stub-out.scope" "--property=MemoryMax=50%" \
  "scope is capped at half the host's memory by default"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "agent still receives its prompt inside the scope"
expect_contains "$w/stub-out.systemctl" "stop kari-agent-issue-pipeline-" \
  "leftover scope is stopped after the agent exits"
expect_contains "$w/out" "reap issue-pipeline" \
  "tick reports that it reaped leftovers"

# A retried tick (#515) is two sessions, so it needs two scopes. Reusing
# the unit name would collide with the first scope whenever the reap has
# not collected it yet, and systemd refuses a duplicate unit — which
# would take out the very retry that is meant to rescue the tick.
w="$(new_work)"
write_fallback_agent "$w"
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_SYSTEMD_RUN_BIN="$STUB_SYSTEMD_RUN" \
KARI_AUTOMATION_SYSTEMCTL_BIN="$STUB_SYSTEMCTL" \
  STUB_CLAUDE="$STUB_LIMIT" run_launch "$w"
expect_eq "$(attempts_of "$w")" 2 "the retry also happens inside a scope"
expect_eq \
  "$(grep -o -- '--unit=[^ ]*' "$w/stub-out.scope" | sort -u | wc -l)" 2 \
  "each attempt gets its own scope unit"
expect_contains "$w/stub-out.scope" "-retry" \
  "the retry's scope unit is marked as the retry"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_MEMORY_MAX=12G \
KARI_AUTOMATION_SYSTEMD_RUN_BIN="$STUB_SYSTEMD_RUN" \
KARI_AUTOMATION_SYSTEMCTL_BIN="$STUB_SYSTEMCTL" run_launch "$w"
expect_contains "$w/stub-out.scope" "--property=MemoryMax=12G" \
  "KARI_AUTOMATION_MEMORY_MAX overrides the cap"

# The scope wrapper is optional, like the inhibitor: no binary, or one that
# cannot create a scope (no user manager: CI runners, containers), must not
# cost the tick its run.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_SYSTEMD_RUN_BIN="/nonexistent/systemd-run" run_launch "$w"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "agent still launches when no systemd-run exists"
expect_file_absent "$w/stub-out.scope" "no scope recorded without systemd-run"

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_SYSTEMD_RUN_BIN="$STUB_BROKEN_INHIBIT" run_launch "$w"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "agent still launches when systemd-run cannot create a scope"

# A scope that is already empty when claude exits is not "stopped" (the
# agent cleaned up after itself): no reap line, no stop call.
STUB_SYSTEMCTL_EMPTY="$STUB_DIR/systemctl-empty-stub"
cat >"$STUB_SYSTEMCTL_EMPTY" <<'EOF'
#!/usr/bin/env bash
echo "SYSTEMCTL: $*" >>"$STUB_OUT.systemctl"
case "$*" in
  *is-active*) exit 3 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$STUB_SYSTEMCTL_EMPTY"
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
KARI_AUTOMATION_SYSTEMD_RUN_BIN="$STUB_SYSTEMD_RUN" \
KARI_AUTOMATION_SYSTEMCTL_BIN="$STUB_SYSTEMCTL_EMPTY" run_launch "$w"
expect_not_contains "$w/stub-out.systemctl" " stop " \
  "an already-empty scope is not stopped"
expect_not_contains "$w/out" "reap issue-pipeline" \
  "no reap line when the agent left nothing behind"

# A failing agent is still reaped, and --wait still reports the failure.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_DIR/claude-failing-stub" \
KARI_AUTOMATION_SYSTEMD_RUN_BIN="$STUB_SYSTEMD_RUN" \
KARI_AUTOMATION_SYSTEMCTL_BIN="$STUB_SYSTEMCTL" run_launch "$w"
expect_contains "$w/stub-out.systemctl" " stop " \
  "a failing agent's scope is still stopped"
expect_eq "$(cat "$w/exit-code")" 1 \
  "--wait still reports the agent's failure after reaping"

# 10. Unknown flags are rejected rather than silently treated as a real tick.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
run_dispatch "$w" --bogus
expect_eq "$(cat "$w/exit-code")" 2 "unknown flag exits 2"
expect_file_absent "$w/state/issue-pipeline.last-run" \
  "unknown flag launches nothing"
expect_no_launch "unknown flag reaches no launch"

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
expect_no_launch "status reaches no launch"

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

# 11e. Sibling names that share our "<name>-" log prefix: `a` and `a-2` both
#      match a `a-*` glob, so run_starts has to reject any filename whose
#      suffix is not a bare timestamp. Without that, `a` tries to parse
#      "2-20260821T101500" as a date and prints parse errors to stderr while
#      dropping the sibling's runs anyway.
w="$(new_work)"
mkdir -p "$w/state/logs"
write_agent "$w" a.md a true 1h fable
write_agent "$w" a-2.md a-2 true 1h fable
log_at "$w" a 20260821T080000
log_at "$w" a 20260821T090000
log_at "$w" a-2 20260821T101500
log_at "$w" a-2 20260821T111000
run_dispatch "$w" --status
expect_eq "$(status_line "$w" a gaps)" "1h00m (2 runs logged, mean 1h00m)" \
  "a digit-suffixed sibling's logs stay out of our gap history"
expect_eq "$(status_line "$w" a-2 gaps)" "55m00s (2 runs logged, mean 55m00s)" \
  "the sibling still reports its own gaps"
expect_not_contains "$w/out" "invalid date" \
  "sibling logs produce no date-parse noise"

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

# 11f. --status-brief (#564): the same data as --status, laid out for a
#      phone. Short lines, one emoji-prefixed block per agent, no gap
#      forensics — telegram.sh's /status sends this one, and 80-column
#      terminal text wraps illegibly in a chat bubble.
#      The ages are all over an hour and deliberately off a minute
#      boundary: fmt_duration drops seconds above 1h, so the second or
#      two between ran_ago writing the stamp and the dispatcher reading
#      the clock cannot flip a digit and make this flaky.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 4h fable
write_agent "$w" demo-agent.md demo-agent false 2h opus
write_agent "$w" lapsed-agent.md lapsed-agent true 1h opus
write_agent "$w" fresh-agent.md fresh-agent true 30m opus
ran_ago "$w" issue-pipeline 7230
ran_ago "$w" lapsed-agent 7230
run_dispatch "$w" --status-brief
expect_eq "$(cat "$w/exit-code")" 0 "status-brief exits 0"
expect_contains "$w/out" "issue-pipeline · every 4h" \
  "status-brief names the agent and its cadence"
expect_contains "$w/out" "last: 2h00m ago" "status-brief dates the last run"
expect_contains "$w/out" "next: in 1h57m" \
  "status-brief says how long until the next run, tolerance included"
expect_contains "$w/out" "overdue by 1h02m" \
  "status-brief flags an overdue agent"
expect_contains "$w/out" "demo-agent · disabled" \
  "a disabled agent says so where its cadence would be"
expect_contains "$w/out" "(no usage records yet)" \
  "status-brief carries the same usage summary --status does"
expect_not_contains "$w/out" "gaps" \
  "the gap forensics stay in --status, where there is room for them"
expect_not_contains "$w/out" "running now" \
  "a free lock costs no line at all"
expect_file_absent "$w/state/fresh-agent.last-run" \
  "status-brief launches nothing"
expect_no_launch "status-brief reaches no launch"

# 11g. A held lock is the one line status-brief adds on demand. Held as
#      test 11a does it, in a subshell around the dispatch call, so there
#      is no background holder to race with.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 600
( flock 9 && run_dispatch "$w" --status-brief ) 9>"$w/state/issue-pipeline.lock"
expect_contains "$w/out" "running now" "status-brief reports a held lock"

# 11h. Paused: the banner, and then the agents anyway. A status reply
#      that says only "paused" withholds the report at the moment it is
#      most wanted.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
touch "$w/PAUSE"
run_dispatch "$w" --status-brief
expect_contains "$w/out" "PAUSED" "status-brief announces the pause"
expect_contains "$w/out" "issue-pipeline · every 1h" \
  "...and still reports the agents"
expect_contains "$w/out" "last: never" "...including one that has never run"
expect_no_launch "a paused status-brief reaches no launch"

# 12. Self-update: a real tick fast-forwards the clone it runs from to
# origin/main before reading agents, so config merged to main takes effect
# on the next tick instead of waiting for a human to pull (#399). Exercised
# against a throwaway bare "origin" and a clone of it carrying a copy of
# dispatch.sh, because REPO_ROOT is derived from the script's own location.
# Quiet on success, loud on failure (#430). Discarding git's stderr made
# a broken fixture invisible: `GIT_COMMITTER_DATE='3 hours ago'` is
# rejected outright ("fatal: invalid date format" — approxidate is not
# accepted in those variables, only @<epoch> or an RFC 2822 / ISO date),
# so the commit never happened, the "aged" fixture stayed fresh, and the
# resulting assertion failures pointed nowhere near the cause. Capture
# the output instead and print it when git exits non-zero, so a fixture
# that cannot be built names itself and counts as a failure of its own
# rather than as a puzzle three assertions later.
#
# That count lives on disk rather than in FAILURES, because fixtures get
# built inside subshells and command substitutions, and a
# `FAILURES=$((FAILURES + 1))` there dies with the subshell: the FAIL
# line prints, nothing counts it, and the harness still exits 0. The
# tally at the end of the file adds this record in, so a fixture that
# cannot be built turns the harness red no matter where it was built.
FIXTURE_FAIL_DIR="$(mktemp -d)"
WORKDIRS+=("$FIXTURE_FAIL_DIR")
FIXTURE_FAILURES="$FIXTURE_FAIL_DIR/fixture-failures"
: >"$FIXTURE_FAILURES"

git_q() {
  local out status
  out="$(git -c user.name=t -c user.email=t@t -c init.defaultBranch=main \
    -c commit.gpgsign=false "$@" 2>&1)"
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "FAIL: fixture command failed (exit $status): git $*"
    printf '%s\n' "$out" | sed 's/^/    /'
    printf 'git %s\n' "$*" >>"$FIXTURE_FAILURES"
  fi
  return "$status"
}
new_repo_pair() { # <workdir> — sets ORIGIN (bare) and CLONE (on main)
  local work="$1"
  ORIGIN="$work/origin.git"
  CLONE="$work/clone"
  git_q init --bare "$ORIGIN"
  git_q clone "$ORIGIN" "$CLONE"
  mkdir -p "$CLONE/automation"
  cp "$DISPATCH" "$CLONE/automation/dispatch.sh"
  cp "$LIVENESS" "$CLONE/automation/claim-liveness.sh"
  git_q -C "$CLONE" add -A
  git_q -C "$CLONE" commit -m "seed"
  git_q -C "$CLONE" push -u origin main
}
push_upstream_commit() { # <workdir> — a second clone lands a commit on main
  local work="$1"
  git_q clone "$ORIGIN" "$work/other"
  echo "upstream" >"$work/other/upstream.txt"
  git_q -C "$work/other" add -A
  git_q -C "$work/other" commit -m "upstream"
  git_q -C "$work/other" push origin main
  rm -rf "$work/other"
}
head_of() { git -C "$1" rev-parse "${2:-HEAD}"; }

# 12a. A real tick on main fast-forwards to origin/main and says so.
w="$(new_work)"
new_repo_pair "$w"
push_upstream_commit "$w"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
DISPATCH="$CLONE/automation/dispatch.sh" SELF_UPDATE=1 run_launch "$w"
expect_eq "$(head_of "$CLONE")" "$(head_of "$ORIGIN" main)" \
  "tick fast-forwards the clone to origin/main"
expect_contains "$w/out" "self-update:" "tick reports the fast-forward"
expect_contains "$w/out" "run issue-pipeline" "tick still launches after updating"

# 12b. Already current: quiet, no self-update line.
DISPATCH="$CLONE/automation/dispatch.sh" SELF_UPDATE=1 run_launch "$w"
expect_not_contains "$w/out" "self-update:" "no report when already current"
expect_not_contains "$w/out" "warn:" "no warning when already current"

# 12c. Not on main: warns, leaves the tree alone, still ticks.
w="$(new_work)"
new_repo_pair "$w"
git_q -C "$CLONE" checkout -b feature
push_upstream_commit "$w"
before="$(head_of "$CLONE")"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
DISPATCH="$CLONE/automation/dispatch.sh" SELF_UPDATE=1 run_launch "$w"
expect_eq "$(head_of "$CLONE")" "$before" "non-main checkout is left alone"
expect_contains "$w/out" "not main" "non-main checkout is reported"
expect_contains "$w/out" "run issue-pipeline" "tick still launches off main"

# 12d. Diverged (local commit on main): warns, keeps local history, ticks.
w="$(new_work)"
new_repo_pair "$w"
push_upstream_commit "$w"
echo "local" >"$CLONE/local.txt"
git_q -C "$CLONE" add -A
git_q -C "$CLONE" commit -m "local"
before="$(head_of "$CLONE")"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
DISPATCH="$CLONE/automation/dispatch.sh" SELF_UPDATE=1 run_launch "$w"
expect_eq "$(head_of "$CLONE")" "$before" "diverged clone keeps its commits"
expect_contains "$w/out" "cannot fast-forward" "divergence is reported"
expect_contains "$w/out" "run issue-pipeline" "tick still launches when diverged"

# 12e. Remote unreachable: warns, ticks on the current checkout.
w="$(new_work)"
new_repo_pair "$w"
rm -rf "$ORIGIN"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
DISPATCH="$CLONE/automation/dispatch.sh" SELF_UPDATE=1 run_launch "$w"
expect_contains "$w/out" "fetch of origin/main failed" "fetch failure is reported"
expect_contains "$w/out" "run issue-pipeline" "tick still launches offline"
expect_eq "$(cat "$w/exit-code")" 0 "fetch failure does not fail the tick"

# 12f. --dry-run and --status never touch the tree, even on main.
w="$(new_work)"
new_repo_pair "$w"
push_upstream_commit "$w"
before="$(head_of "$CLONE")"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
DISPATCH="$CLONE/automation/dispatch.sh" SELF_UPDATE=1 run_dispatch "$w" --dry-run
DISPATCH="$CLONE/automation/dispatch.sh" SELF_UPDATE=1 run_dispatch "$w" --status
expect_eq "$(head_of "$CLONE")" "$before" "diagnostic modes do not update"
expect_no_launch "diagnostic modes reach no launch"

# 12g. KARI_AUTOMATION_SELF_UPDATE=0 opts out entirely.
DISPATCH="$CLONE/automation/dispatch.sh" SELF_UPDATE=0 run_launch "$w"
expect_eq "$(head_of "$CLONE")" "$before" "opt-out leaves the clone alone"
expect_not_contains "$w/out" "warn:" "opt-out is silent"

# 13. Log trailer (#325): every per-run log ends in "tick exited <code>",
#     so the playbook (and claim-liveness.sh) can test whether the tick
#     that dispatched a worker finished or died, instead of pattern-
#     matching whatever claude printed last.
only_log() { # <workdir> — the single issue-pipeline log of the last run
  find "$1/state/logs" -name 'issue-pipeline-*.log' | head -n1
}

w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
run_launch "$w"
expect_eq "$(tail -n1 "$(only_log "$w")")" "tick exited 0" \
  "a clean tick's log ends in tick exited 0"

# The code is the agent's, not a constant: a failing session says so.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_DIR/claude-failing-stub" run_launch "$w"
expect_eq "$(tail -n1 "$(only_log "$w")")" "tick exited 3" \
  "a failing tick's log ends in its exit code"
expect_eq "$(cat "$w/exit-code")" 1 \
  "--wait still reports the failure with the trailer in place"

# The usage-limit shape (#322): claude prints its message without a
# trailing newline and dies. The trailer must not land on the same line —
# the message has to survive intact for a later matcher to find.
STUB_LIMIT="$STUB_DIR/claude-limit-stub"
cat >"$STUB_LIMIT" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf "You've hit your session limit"
exit 1
EOF
chmod +x "$STUB_LIMIT"
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_LIMIT" run_launch "$w"
log="$(only_log "$w")"
expect_eq "$(tail -n1 "$log")" "tick exited 1" \
  "a log that ended mid-line still gets the trailer on its own line"
expect_eq "$(grep -c "You've hit your session limit" "$log")" 1 \
  "the unterminated last line survives the newline guard"

# Usage capture (#467): the session runs with --output-format json, and
#     its result object is folded back into the log -- the result text
#     (so the log reads as before), a "usage:" line, one "usage <model>:"
#     line per model -- with the raw object kept under state/usage/ for
#     a cost review to sum. Output that is not a result object (a
#     usage-limit message, a crash) lands in the log verbatim with a
#     "usage: unavailable" line and no record.
STUB_JSON="$STUB_DIR/claude-json-stub"
cat >"$STUB_JSON" <<'EOF'
#!/usr/bin/env bash
echo "ARGS: $*" >"$STUB_OUT"
cat >/dev/null
echo "a warning on stderr" >&2
cat <<'JSON'
{"type":"result","subtype":"success","is_error":false,"duration_ms":61500,
 "num_turns":7,"result":"Run summary: merged #1, claimed #2.",
 "total_cost_usd":1.25,
 "usage":{"input_tokens":10,"cache_creation_input_tokens":200,
  "cache_read_input_tokens":3000,"output_tokens":40},
 "modelUsage":{"claude-fable-5":{"inputTokens":10,"outputTokens":40,
  "cacheReadInputTokens":3000,"cacheCreationInputTokens":200,
  "costUSD":1.25}}}
JSON
EOF
chmod +x "$STUB_JSON"
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_JSON" run_launch "$w"
log="$(only_log "$w")"
expect_contains "$w/stub-out" "--output-format json" \
  "the session is asked for a JSON result"
expect_contains "$log" "a warning on stderr" "stderr still streams to the log"
expect_contains "$log" "Run summary: merged #1, claimed #2." \
  "the result text is folded into the log"
expect_contains "$log" \
  "usage: cost_usd=1.25 turns=7 duration_s=61 input=10 output=40 cache_read=3000 cache_create=200 error=false" \
  "the usage line sums the session"
expect_contains "$log" \
  "usage claude-fable-5: cost_usd=1.25 input=10 output=40 cache_read=3000 cache_create=200" \
  "one usage line per model"
expect_eq "$(tail -n1 "$log")" "tick exited 0" \
  "the trailer still closes the log after the usage lines"
expect_eq "$(find "$w/state/usage" -name 'issue-pipeline-*.json' | wc -l)" 1 \
  "the raw result object is kept as a usage record"
expect_eq "$(find "$w/state/logs" -name '*.stdout' | wc -l)" 0 \
  "the stdout sidecar is removed once folded in"
run_dispatch "$w" --status
expect_eq "$(status_line "$w" issue-pipeline usage)" \
  "1 runs, \$1.25 total, \$1.25 mean (180d)" \
  "--status sums the usage records"

# Non-JSON output: kept verbatim, usage declared unavailable, no record.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_LIMIT" run_launch "$w"
log="$(only_log "$w")"
expect_contains "$log" "You've hit your session limit" \
  "non-JSON output survives in the log"
expect_contains "$log" "usage: unavailable" \
  "non-JSON output is reported as no usage"
expect_eq "$(find "$w/state/usage" -name '*.json' | wc -l)" 0 \
  "no usage record for non-JSON output"
run_dispatch "$w" --status
expect_eq "$(status_line "$w" issue-pipeline usage)" "(no usage records yet)" \
  "--status says when there is nothing to sum"

# No jq on the host: the raw output is kept verbatim and usage declared
# unavailable -- and, as in the trailer's case (#322), the "usage:" line
# must not be glued onto output that ended mid-line. The limit stub is
# exactly that shape, so this covers both at once.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_JQ=/nonexistent/jq STUB_CLAUDE="$STUB_LIMIT" run_launch "$w"
log="$(only_log "$w")"
expect_eq "$(grep -c "^You've hit your session limit$" "$log")" 1 \
  "without jq the unterminated output still ends up on its own line"
expect_eq \
  "$(grep -c '^usage: unavailable (jq not installed; raw output above)$' \
    "$log")" 1 \
  "without jq the usage line starts a line of its own"
expect_eq "$(tail -n1 "$log")" "tick exited 1" \
  "the trailer still closes a jq-less log"
expect_eq "$(find "$w/state/usage" -name '*.json' | wc -l)" 0 \
  "no usage record is written without jq"
# ...and --status says why it cannot sum records rather than claiming none.
mkdir -p "$w/state/usage"
echo '{}' >"$w/state/usage/issue-pipeline-20260101-000000.json"
STUB_JQ=/nonexistent/jq run_dispatch "$w" --status
expect_eq "$(status_line "$w" issue-pipeline usage)" \
  "(1 records; jq needed to sum them)" \
  "--status reports records it cannot sum without jq"

# Killed by a signal (a scope stop, or the timer's KillMode): bash runs no
# EXIT trap on an untrapped fatal signal, so TERM/HUP/INT are trapped into
# a normal exit and the log still gets a trailer.
STUB_SIGNAL="$STUB_DIR/claude-signal-stub"
cat >"$STUB_SIGNAL" <<'EOF'
#!/usr/bin/env bash
echo "$PPID" >"$STUB_OUT.ppid"
kill -TERM "$PPID"
cat >/dev/null
sleep 1
exit 0
EOF
chmod +x "$STUB_SIGNAL"
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_SIGNAL" run_launch "$w"
expect_eq "$(tail -n1 "$(only_log "$w")")" "tick exited 143" \
  "a tick killed by SIGTERM still writes a trailer"
expect_eq "$(cat "$w/exit-code")" 1 \
  "--wait reports a signalled tick as a failure"

# The skip path (a previous run still holds the lock) creates no log, so
# it must not create one just to write a trailer into it.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
export STUB_OUT="$w/stub-out"
mkdir -p "$w/state/logs"
( flock 9 && run_launch "$w" ) 9>"$w/state/issue-pipeline.lock"
expect_contains "$w/out" "still holds the lock" "the locked-out tick skipped"
expect_eq "$(find "$w/state/logs" -name 'issue-pipeline-*.log' | wc -l)" 0 \
  "the skip path writes no log and no trailer"

# 14. claim-liveness.sh (#325): the playbook's Phase B conjunction as a
#     script. One "key=value" line per signal, then alive_by= and
#     verdict=. Like claim-liveness.sh itself, these tests run against a
#     throwaway origin/clone pair with a linked worktree beside it,
#     because the script derives both paths from its own location.

# gh stub: `pr list` answers from STUB_GH_PR (empty = no open PR),
# `issue view` from STUB_GH_UPDATED, and STUB_GH_FAIL=1 makes both fail
# the way a rate-limited or logged-out gh does.
STUB_GH="$STUB_DIR/gh-stub"
cat >"$STUB_GH" <<'EOF'
#!/usr/bin/env bash
if [ "${STUB_GH_FAIL:-0}" = 1 ]; then
  echo "gh: stubbed failure" >&2
  exit 1
fi
case "$1" in
  pr) echo "${STUB_GH_PR:-}" ;;
  issue) echo "${STUB_GH_UPDATED:-}" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$STUB_GH"

# A `comm` no ancestor of this harness can have. Run inside a Claude Code
# session, every process the harness spawns has a real `claude` ancestor,
# so the script's default would make claude_process=yes unfalsifiable and
# the negative test would pass for free.
# `comm` is the basename of the file that was exec'd, truncated to 15
# chars — so a SYMLINK to bash carries it, while a `#!` script does not
# (that one execs the interpreter, and reports `bash`).
LIVENESS_COMM="clstub$$"
ln -sf "$(command -v bash)" "$STUB_DIR/$LIVENESS_COMM"

run_liveness() { # <workdir> [args...] — output in <workdir>/out
  local work="$1"
  shift
  KARI_AUTOMATION_STATE_DIR="$work/state" \
  KARI_AUTOMATION_GH_BIN="$STUB_GH" \
  KARI_AUTOMATION_CLAUDE_COMM="${LIVENESS_COMM_OVERRIDE:-$LIVENESS_COMM}" \
  STUB_GH_PR="${STUB_GH_PR:-}" \
  STUB_GH_UPDATED="${STUB_GH_UPDATED:-}" \
  STUB_GH_FAIL="${STUB_GH_FAIL:-0}" \
    bash "$CLONE/automation/claim-liveness.sh" "$@" >"$work/out" 2>&1
  echo $? >"$work/exit-code"
}

# The output contract is "key=value", one per line; tests read a key
# rather than matching on line numbers or wording.
fact_of() { # <workdir> <key> — "" when the key was not printed
  awk -F= -v k="$2" '$1 == k { print substr($0, length(k) + 2); exit }' \
    "$1/out"
}
alive_by_has() { # <workdir> <key> — yes|no
  case ",$(fact_of "$1" alive_by)," in
    *",$2,"*) echo yes ;;
    *) echo no ;;
  esac
}

new_liveness() { # <workdir> <slug> — origin/clone pair + linked worktree
  local work="$1" slug="$2"
  new_repo_pair "$work"
  LIVE_W="$work/kari-website-$slug"
  git_q -C "$CLONE" worktree add "$LIVE_W" -b "agent/$slug"
}

# Everything a worker could have touched pushed outside the window: the
# branch tip's committer date, the working files, and the linked
# worktree's git dir under the main clone (the commit writes there, so it
# has to happen before the touch).
age_liveness() {
  local gitdir aged
  gitdir="$(git -C "$LIVE_W" rev-parse --absolute-git-dir)"
  # RFC 2822, not "3 hours ago": git rejects approxidate in these
  # variables outright ("fatal: invalid date format"), leaving the
  # fixture's tip at the seed commit's timestamp — fresh. git_q prints
  # git's stderr and records a failure on a non-zero exit (#430), so that
  # mistake names itself instead of surfacing as unrelated verdict
  # assertions.
  # Prefixed onto the call, not exported inside a `( … )` around it: bash
  # does put a prefix assignment in the environment of the commands a
  # function runs, and unsets it again when the function returns, so no
  # later fixture is dated by accident — and, unlike a subshell, a
  # failure here is still on the same shell's books.
  aged="$(date -R -d '3 hours ago')"
  GIT_AUTHOR_DATE="$aged" GIT_COMMITTER_DATE="$aged" \
    git_q -C "$LIVE_W" commit --allow-empty -m "old work"
  find "$LIVE_W" -exec touch -d '3 hours ago' {} +
  find "$gitdir" -exec touch -d '3 hours ago' {} +
}

push_upstream_branch() { # <workdir> <branch> — a second clone pushes to it
  local work="$1" branch="$2"
  git_q clone "$ORIGIN" "$work/other"
  git_q -C "$work/other" checkout -b "$branch"
  echo "upstream work" >"$work/other/upstream-work.txt"
  git_q -C "$work/other" add -A
  git_q -C "$work/other" commit -m "upstream work"
  git_q -C "$work/other" push -u origin "$branch"
  rm -rf "$work/other"
}

OLD_ISO="$(date -u -d '3 hours ago' +%Y-%m-%dT%H:%M:%SZ)"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 14a. A worktree written just now is life on its own, with no PR, no
#      commits and no issues to corroborate it.
w="$(new_work)"
new_liveness "$w" fresh
run_liveness "$w" fresh
expect_eq "$(cat "$w/exit-code")" 0 "liveness exits 0 when it printed a verdict"
expect_eq "$(fact_of "$w" slug)" fresh "the slug is echoed back"
expect_eq "$(fact_of "$w" branch)" agent/fresh "the branch is derived"
expect_eq "$(fact_of "$w" worktree)" "$LIVE_W" \
  "the worktree is the repo root's sibling"
expect_eq "$(fact_of "$w" window_min)" 120 "the window is stated once"
expect_eq "$(fact_of "$w" worktree_recent)" yes "a fresh worktree is recent"
expect_eq "$(fact_of "$w" issues)" none "no issue arguments means no issues"
expect_eq "$(alive_by_has "$w" worktree_recent)" yes \
  "alive_by names the signal that kept it alive"
expect_eq "$(fact_of "$w" verdict)" ALIVE "a fresh worktree is ALIVE"

# 14b. The full conjunction: no PR, nothing written for 3h, no commit for
#      3h, the claimed issue untouched for 3h, no process. Only this
#      releases a claim.
w="$(new_work)"
new_liveness "$w" dead
age_liveness
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" dead 41
expect_eq "$(fact_of "$w" worktree_recent)" no "an aged worktree is not recent"
expect_eq "$(fact_of "$w" gitdir_recent)" no "an aged git dir is not recent"
expect_eq "$(fact_of "$w" open_pr)" none "no open PR on the branch"
expect_eq "$(fact_of "$w" fetch)" ok "the fetch succeeded"
expect_eq "$(fact_of "$w" local_tip_recent)" no \
  "an aged local tip is not recent"
expect_eq "$(fact_of "$w" remote_tip)" none \
  "an unpushed branch has no remote tip"
expect_eq "$(fact_of "$w" issues)" 41 "claimed issues come from the arguments"
expect_eq "$(fact_of "$w" issue_41_updated)" "$OLD_ISO" \
  "the issue's updatedAt is reported"
expect_eq "$(fact_of "$w" issue_41_recent)" no \
  "a 3h-old issue update is not recent"
expect_eq "$(fact_of "$w" claude_process)" no \
  "no claude process in the worktree"
expect_eq "$(fact_of "$w" alive_by)" none "nothing kept the claim alive"
expect_eq "$(fact_of "$w" verdict)" DEAD "silence on every signal is DEAD"

# 14c. An open PR alone keeps it alive — the claim is Phase A's problem.
w="$(new_work)"
new_liveness "$w" withpr
age_liveness
STUB_GH_PR=17 STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" withpr 41
expect_eq "$(fact_of "$w" open_pr)" 17 "the open PR number is reported"
expect_eq "$(alive_by_has "$w" open_pr)" yes "an open PR is named in alive_by"
expect_eq "$(fact_of "$w" verdict)" ALIVE "an open PR keeps the claim alive"

# 14d. Issue activity alone keeps it alive — this is what gives a
#      just-claimed branch its grace period (the claim comment itself).
w="$(new_work)"
new_liveness "$w" claimed
age_liveness
STUB_GH_UPDATED="$NOW_ISO" run_liveness "$w" claimed 41
expect_eq "$(fact_of "$w" issue_41_recent)" yes "a fresh issue update is recent"
expect_eq "$(fact_of "$w" verdict)" ALIVE "issue activity keeps the claim alive"

# 14e. A commit pushed to origin but never merged back into the local
#      worktree still counts: workers are told to push WIP as the
#      reliable record, and the tick reads it after its own fetch.
w="$(new_work)"
new_liveness "$w" pushed
age_liveness
push_upstream_branch "$w" agent/pushed
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" pushed 41
expect_eq "$(fact_of "$w" remote_tip_recent)" yes "a fresh remote tip is recent"
expect_eq "$(fact_of "$w" local_tip_recent)" no "the local tip is still aged"
expect_eq "$(fact_of "$w" verdict)" ALIVE \
  "a pushed commit keeps the claim alive"

# ...and the mirror: a local commit the worker has not pushed yet.
w="$(new_work)"
new_liveness "$w" localonly
age_liveness
git_q -C "$LIVE_W" commit --allow-empty -m "fresh local work"
find "$LIVE_W" -exec touch -d '3 hours ago' {} +
find "$(git -C "$LIVE_W" rev-parse --absolute-git-dir)" \
  -exec touch -d '3 hours ago' {} +
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" localonly 41
expect_eq "$(fact_of "$w" local_tip_recent)" yes "a fresh local tip is recent"
expect_eq "$(fact_of "$w" remote_tip)" none "nothing was pushed"
expect_eq "$(fact_of "$w" verdict)" ALIVE \
  "an unpushed local commit keeps the claim alive"

# 14f. Git-metadata-only activity (index staging, a fetch that moved no
#      files) lives under the MAIN clone's .git/worktrees/<name>, which
#      `find $W` never visits. Without the second probe this reads as
#      silence and a working worker gets released.
w="$(new_work)"
new_liveness "$w" gitonly
age_liveness
touch "$(git -C "$LIVE_W" rev-parse --absolute-git-dir)/index"
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" gitonly 41
expect_eq "$(fact_of "$w" worktree_recent)" no "no working file was touched"
expect_eq "$(fact_of "$w" gitdir_recent)" yes "the git dir probe sees it"
expect_eq "$(fact_of "$w" verdict)" ALIVE \
  "git-metadata-only activity keeps the claim alive"

# 14g. A missing worktree is silent, not dead: the other signals decide.
w="$(new_work)"
new_liveness "$w" gone
age_liveness
rm -rf "$LIVE_W"
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" gone 41
expect_eq "$(fact_of "$w" worktree_recent)" missing "a missing worktree says so"
expect_eq "$(fact_of "$w" gitdir_recent)" missing "...and so does its git dir"
expect_eq "$(fact_of "$w" uncommitted)" missing "...and the rescue probe"
expect_eq "$(fact_of "$w" verdict)" DEAD \
  "a missing worktree does not rescue a claim every other signal calls dead"

# 14h. A process whose cwd is in the worktree and whose ancestry reaches a
#      claude is life. The fifo holds it open for exactly as long as the
#      probe needs, so there is no sleep to race.
w="$(new_work)"
new_liveness "$w" busy
age_liveness
mkfifo "$w/hold"
# shellcheck disable=SC2016  # $1..$3 are the inner bash -c's, not ours
"$STUB_DIR/$LIVENESS_COMM" -c \
  'cd "$1" || exit 1; : >"$2"; read -r _ <"$3"' \
  _ "$LIVE_W" "$w/ready" "$w/hold" &
live_pid=$!
for _ in $(seq 100); do [ -e "$w/ready" ] && break; sleep 0.05; done
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" busy 41
echo go >"$w/hold"
wait "$live_pid" 2>/dev/null || true
expect_eq "$(fact_of "$w" claude_process)" yes \
  "a claude-descended process in the worktree is life"
expect_eq "$(fact_of "$w" verdict)" ALIVE "...and keeps the claim alive"

# ...while debris a dead worker left behind (an orphaned dev server, a
# shell with no claude above it) is not. This must fail when it should:
# hence the stub comm, since the harness itself has a real claude ancestor.
w="$(new_work)"
new_liveness "$w" debris
age_liveness
mkfifo "$w/hold"
( cd "$LIVE_W" && read -r _ <"$w/hold" ) &
debris_pid=$!
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" debris 41
echo go >"$w/hold"
wait "$debris_pid" 2>/dev/null || true
expect_eq "$(fact_of "$w" claude_process)" no \
  "a process with no claude ancestor is not life"
expect_eq "$(fact_of "$w" verdict)" DEAD "...and does not save the claim"

# ...and neither is a live worker on a DIFFERENT slug whose worktree name
# merely extends ours: agent/debris must not be kept alive by
# kari-website-debris-2.
w="$(new_work)"
new_liveness "$w" debris
age_liveness
mkdir -p "$w/kari-website-debris-2"
mkfifo "$w/hold"
# shellcheck disable=SC2016  # $1..$3 are the inner bash -c's, not ours
"$STUB_DIR/$LIVENESS_COMM" -c \
  'cd "$1" || exit 1; : >"$2"; read -r _ <"$3"' \
  _ "$w/kari-website-debris-2" "$w/ready" "$w/hold" &
sibling_pid=$!
for _ in $(seq 100); do [ -e "$w/ready" ] && break; sleep 0.05; done
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" debris 41
echo go >"$w/hold"
wait "$sibling_pid" 2>/dev/null || true
expect_eq "$(fact_of "$w" claude_process)" no \
  "a worker in a name-extending sibling worktree is not our worker"
expect_eq "$(fact_of "$w" verdict)" DEAD "...and does not save our claim"

# 14i. A failed probe counts as life. A gh outage that read as "no PR,
#      no issue activity" would delete live workers' worktrees wholesale.
w="$(new_work)"
new_liveness "$w" ghdown
age_liveness
STUB_GH_FAIL=1 run_liveness "$w" ghdown 41
expect_eq "$(fact_of "$w" open_pr)" error \
  "a failing gh is reported, not assumed"
expect_eq "$(fact_of "$w" issue_41_updated)" error "...for issues too"
expect_eq "$(alive_by_has "$w" gh-error)" yes "the failure is named in alive_by"
expect_eq "$(fact_of "$w" verdict)" ALIVE \
  "a gh outage can never release a claim"

# ...including a branch with no claimed issues at all, where the PR probe
# is the only gh call there is.
w="$(new_work)"
new_liveness "$w" ghdown2
age_liveness
STUB_GH_FAIL=1 run_liveness "$w" ghdown2
expect_eq "$(fact_of "$w" open_pr)" error "a failing pr list is reported"
expect_eq "$(alive_by_has "$w" gh-error)" yes \
  "a failing pr list alone is enough to count as life"
expect_eq "$(fact_of "$w" verdict)" ALIVE \
  "a gh outage keeps an issue-less branch alive too"

# The same for an unreachable remote: without the fetch the branch tips
# are stale readings, so "no recent commit" is not a fact we have.
w="$(new_work)"
new_liveness "$w" offline
age_liveness
rm -rf "$ORIGIN"
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" offline 41
expect_eq "$(fact_of "$w" fetch)" failed "a failed fetch is reported"
expect_eq "$(alive_by_has "$w" fetch-error)" yes \
  "a failed fetch counts as life"
expect_eq "$(fact_of "$w" verdict)" ALIVE \
  "an unreachable remote can never release a claim"

# 14j. The dispatching tick's log and its trailer (section 13): printed
#      for the run summary, never part of the verdict.
w="$(new_work)"
new_liveness "$w" logged
age_liveness
mkdir -p "$w/state/logs"
cat >"$w/state/logs/issue-pipeline-20260821T090000.log" <<'EOF'
dispatched worker for agent/logged
You've hit your session limit
tick exited 1
EOF
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" logged 41
expect_eq "$(fact_of "$w" tick_log)" \
  "$w/state/logs/issue-pipeline-20260821T090000.log" \
  "the tick log mentioning the branch is found"
expect_eq "$(fact_of "$w" tick_log_trailer)" 1 \
  "the trailer's exit code is read off the last line"
expect_eq "$(fact_of "$w" tick_log_last)" "tick exited 1" \
  "the log's last line is quoted verbatim"
expect_eq "$(fact_of "$w" verdict)" DEAD \
  "a tick log does not change the verdict the conjunction reached"

# A log with no trailer means SIGKILL (the OOM killer) or a tick still
# running — never "finished cleanly".
w="$(new_work)"
new_liveness "$w" killed
age_liveness
mkdir -p "$w/state/logs"
printf 'dispatched worker for agent/killed\nstill working\n' \
  >"$w/state/logs/issue-pipeline-20260821T090000.log"
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" killed 41
expect_eq "$(fact_of "$w" tick_log_trailer)" none \
  "a log with no trailer says none"
expect_eq "$(fact_of "$w" tick_log_last)" "still working" \
  "the last line is still reported"

# A log belonging to another slug is not ours.
w="$(new_work)"
new_liveness "$w" unlogged
age_liveness
mkdir -p "$w/state/logs"
printf 'dispatched worker for agent/somebody-else\ntick exited 0\n' \
  >"$w/state/logs/issue-pipeline-20260821T090000.log"
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" unlogged 41
expect_eq "$(fact_of "$w" tick_log)" none "another slug's log is not ours"
expect_eq "$(fact_of "$w" tick_log_trailer)" none \
  "...and contributes no trailer"

# ...and neither does a NAME-EXTENDING sibling's, which a substring match
# cannot tell from ours: every line naming agent/sibling-2 also contains
# the string "agent/sibling". Here the sibling's log is the NEWER one, so
# a substring probe would hand the run summary that log's "tick exited 1"
# while our own tick was SIGKILLed (trailer none) — misattributing the
# death cause the trailer exists to record.
w="$(new_work)"
new_liveness "$w" sibling
age_liveness
mkdir -p "$w/state/logs"
printf 'dispatched worker for agent/sibling\nstill working\n' \
  >"$w/state/logs/issue-pipeline-20260821T090000.log"
printf 'dispatched worker for agent/sibling-2\ntick exited 1\n' \
  >"$w/state/logs/issue-pipeline-20260821T100000.log"
touch -d '2 hours ago' "$w/state/logs/issue-pipeline-20260821T090000.log"
touch -d '1 hour ago' "$w/state/logs/issue-pipeline-20260821T100000.log"
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" sibling 41
expect_eq "$(fact_of "$w" tick_log)" \
  "$w/state/logs/issue-pipeline-20260821T090000.log" \
  "a name-extending sibling's newer log is not ours"
expect_eq "$(fact_of "$w" tick_log_trailer)" none \
  "...so our SIGKILLed tick keeps its empty trailer"
expect_eq "$(fact_of "$w" tick_log_last)" "still working" \
  "...and the sibling's exit code is not quoted as ours"

# A mention at end of line, with nothing after the branch name, is still
# ours: the boundary the sibling case needs must not cost us that.
w="$(new_work)"
new_liveness "$w" eol
age_liveness
mkdir -p "$w/state/logs"
printf 'dispatched worker for origin/agent/eol\ntick exited 0\n' \
  >"$w/state/logs/issue-pipeline-20260821T090000.log"
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" eol 41
expect_eq "$(fact_of "$w" tick_log)" \
  "$w/state/logs/issue-pipeline-20260821T090000.log" \
  "a branch named at end of line is found"
expect_eq "$(fact_of "$w" tick_log_trailer)" 0 "...with its trailer"

# 14k. The probe must not manufacture life. `git status` refreshes the
#      index, which writes into the linked worktree's git dir — run
#      without --no-optional-locks, the second tick would see a fresh
#      mtime, and every tick after it, so a dead claim would never
#      release. Running the helper twice has to leave the verdict alone.
w="$(new_work)"
new_liveness "$w" leftovers
age_liveness
echo "half-written component" >"$LIVE_W/wip.txt"
find "$LIVE_W" -exec touch -d '3 hours ago' {} +
find "$(git -C "$LIVE_W" rev-parse --absolute-git-dir)" \
  -exec touch -d '3 hours ago' {} +
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" leftovers 41
expect_eq "$(fact_of "$w" uncommitted)" yes \
  "uncommitted work is flagged for the rescue step"
expect_eq "$(fact_of "$w" verdict)" DEAD \
  "uncommitted work is corroborating only, not a life signal"
STUB_GH_UPDATED="$OLD_ISO" run_liveness "$w" leftovers 41
expect_eq "$(fact_of "$w" gitdir_recent)" no \
  "a second run still sees an aged git dir (the probe wrote nothing)"
expect_eq "$(fact_of "$w" worktree_recent)" no \
  "...and an aged worktree"
expect_eq "$(fact_of "$w" verdict)" DEAD "...so the verdict is stable"

# 14l. No slug: a usage error, not a verdict a caller could act on.
w="$(new_work)"
new_liveness "$w" nousage
run_liveness "$w"
expect_eq "$(cat "$w/exit-code")" 2 "no slug exits 2"
expect_eq "$(fact_of "$w" verdict)" "" "no slug prints no verdict"

# 15. Telegram transport (#463). The dispatcher polls the phone channel
#     at the top of every tick, alerts on failures the fleet cannot
#     report itself, and honours the nudge a reply leaves behind. The
#     stub records its argv and answers `send` with a message id, which
#     is what dispatch.sh reads as "delivered" before stamping the
#     rate limit.
STUB_TELEGRAM_BIN="$STUB_DIR/telegram-stub"
cat >"$STUB_TELEGRAM_BIN" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$TELEGRAM_LOG"
[ "${1:-}" = send ] && echo 41
exit 0
EOF
chmod +x "$STUB_TELEGRAM_BIN"

new_telegram_log() { # <workdir> — a fresh log this test alone writes to
  export TELEGRAM_LOG="$1/telegram-log"
  : >"$TELEGRAM_LOG"
}

sends_of() { # <workdir> — how many `send` calls the stub recorded
  grep -c '^send ' "$TELEGRAM_LOG" 2>/dev/null || true
}

# 15a. A real tick polls for replies. The agent is not due, so this is a
#      tick that does nothing else at all — the poll is not a side effect
#      of launching something.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
new_telegram_log "$w"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w"
expect_eq "$(cat "$w/exit-code")" 0 "a polling tick exits 0"
expect_contains "$TELEGRAM_LOG" "poll" "a run-mode tick polls Telegram"
expect_no_launch "polling launches nothing"

# 15b. A paused fleet still polls: /resume arrives over Telegram, so a
#      fleet that stops listening while paused can never be restarted
#      from the phone.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
touch "$w/PAUSE"
new_telegram_log "$w"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w"
expect_contains "$TELEGRAM_LOG" "poll" "a paused fleet still polls"
expect_contains "$w/out" "fleet paused" "...and still reports the pause"
expect_no_launch "a paused fleet launches nothing"

# 15c. Diagnostics never poll: consuming a message is a side effect, and
#      --dry-run/--status exist to change nothing.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
new_telegram_log "$w"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w" --dry-run
expect_eq "$(wc -c <"$TELEGRAM_LOG")" 0 "--dry-run does not poll"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w" --status
expect_eq "$(wc -c <"$TELEGRAM_LOG")" 0 "--status does not poll"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w" --status-brief
expect_eq "$(wc -c <"$TELEGRAM_LOG")" 0 "--status-brief does not poll"

# 15d. The nudge: an answer from the phone means something was just
#      unblocked, so the next tick runs every enabled agent instead of
#      waiting out the rest of its cadence. The file is consumed, or the
#      fleet would run flat out forever.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
touch "$w/state/nudge"
new_telegram_log "$w"
export STUB_OUT="$w/stub-out"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_launch "$w"
expect_contains "$w/stub-out" "This is the issue-pipeline prompt body." \
  "a nudge makes a not-due agent run"
expect_file_absent "$w/state/nudge" "the tick consumes the nudge"

# 15e. ...and a diagnostic neither consumes it nor pretends it is due:
#      the nudge is owed to the next REAL tick.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
touch "$w/state/nudge"
run_dispatch "$w" --dry-run
expect_eq "$(decision_of "$w" issue-pipeline)" not-due \
  "--dry-run reports the real due state, nudge or no nudge"
expect_file "$w/state/nudge" "--dry-run leaves the nudge for a real tick"

# 15f. A tick that exited non-zero is alerted on once, and once only:
#      the failure that matters clusters over consecutive ticks, and a
#      channel that buzzes four times for one outage gets muted.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
mkdir -p "$w/state/alerts" "$w/state/logs"
FAILED_LOG="$w/state/logs/issue-pipeline-20260829T000000.log"
printf 'some session output\ntick exited 1\n' >"$FAILED_LOG"
# An existing last-scan stamp makes this a normal scan rather than the
# baseline-only first one (15h).
touch -d '1 hour ago' "$w/state/alerts/last-scan"
new_telegram_log "$w"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w"
expect_contains "$TELEGRAM_LOG" "exited non-zero" \
  "a non-zero tick trailer raises an alert"
expect_contains "$TELEGRAM_LOG" "issue-pipeline-20260829T000000" \
  "the alert names the log to open"
expect_eq "$(tail -n1 "$TELEGRAM_LOG")" "issue-pipeline-20260829T000000" \
  "the log name sits on a line of its own, not run on after the summary"
expect_file "$w/state/alerts/tick-failed.stamp" \
  "a delivered alert stamps its condition"
# Re-touched so the log is newer than the scan stamp the tick just wrote:
# without that the second tick would skip it for being old, and the
# rate limit would never be exercised.
touch "$FAILED_LOG"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w"
expect_eq "$(sends_of "$w")" 1 "the same condition is not alerted twice"

# 15g. A usage/spend limit is its own condition, so it can be worded for
#      what it is (wait, or raise the cap) rather than "something failed".
#      Classified on the stable shape of the message, not its exact
#      wording: #322 saw "monthly spend limit" and it reads "reached your
#      Fable 5 limit" today.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
mkdir -p "$w/state/alerts" "$w/state/logs"
printf "You've reached your Fable 5 limit\ntick exited 1\n" \
  >"$w/state/logs/issue-pipeline-20260829T010000.log"
touch -d '1 hour ago' "$w/state/alerts/last-scan"
new_telegram_log "$w"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w"
expect_contains "$TELEGRAM_LOG" "usage/spend limit" \
  "a limit-killed tick is alerted as a limit, not a generic failure"
expect_file "$w/state/alerts/usage-limit.stamp" \
  "the limit condition has its own stamp"
expect_file_absent "$w/state/alerts/tick-failed.stamp" \
  "a limit kill is not also counted as a plain failure"

# 15h. The first scan is baseline only. A transport configured today must
#      not open by relitigating the 30 days of logs already on disk.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
mkdir -p "$w/state/logs"
printf 'old news\ntick exited 1\n' \
  >"$w/state/logs/issue-pipeline-20260828T000000.log"
new_telegram_log "$w"
STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w"
expect_eq "$(sends_of "$w")" 0 "the first scan sends nothing"
expect_file "$w/state/alerts/last-scan" "...but records the baseline"

# 15i. A wedged tick is invisible to the log scan — it never wrote a
#      trailer — so the held lock is the signal. Held here exactly as
#      test 11a does it, in a subshell around the dispatch call, so there
#      is no background holder to race with or clean up. The agent is not
#      due, so the tick's own launch path never wants the same lock.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 4h fable
ran_ago "$w" issue-pipeline 7200
new_telegram_log "$w"
(
  flock 9 &&
    KARI_AUTOMATION_BG_WAIT_CEILING_MS=1000 \
    KARI_AUTOMATION_LOCK_ALERT_SLACK=0 \
    STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w"
) 9>"$w/state/issue-pipeline.lock"
expect_contains "$TELEGRAM_LOG" "held its lock" \
  "a long-held lock raises a hang alert"
expect_file "$w/state/alerts/lock-issue-pipeline.stamp" \
  "the hang alert is stamped per agent"

# 15j. ...and a lock held for less than the ceiling plus slack is just a
#      run in progress.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 4h fable
ran_ago "$w" issue-pipeline 60
new_telegram_log "$w"
( flock 9 && STUB_TELEGRAM="$STUB_TELEGRAM_BIN" run_dispatch "$w" ) \
  9>"$w/state/issue-pipeline.lock"
expect_eq "$(sends_of "$w")" 0 "a lock held briefly raises nothing"

# 15k. The transport is optional infrastructure: a missing (or broken)
#      telegram.sh degrades to a silent fleet, never a stopped one.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
STUB_TELEGRAM=/nonexistent/telegram run_dispatch "$w"
expect_eq "$(cat "$w/exit-code")" 0 "an absent transport still exits 0"
expect_contains "$w/out" "telegram poll failed" \
  "...and says so rather than failing silently"
expect_no_launch "an absent transport launches nothing"

# 16. Harness self-tests: the harness's own red is a property worth
#     pinning. A fixture command that cannot run has to turn this file
#     red from anywhere it is called, including inside a subshell —
#     where an increment of FAILURES dies with the subshell and prints a
#     FAIL line nothing counts (the shape #430's own fixture had). So
#     git_q records on disk, and these read that record directly; the
#     line above the exit check is what turns it into the exit status.
w="$(new_work)"
selftest_before="$(wc -l <"$FIXTURE_FAILURES")"

( git_q -C "$w/not-a-repo" rev-parse HEAD ) >/dev/null
expect_eq "$(($(wc -l <"$FIXTURE_FAILURES") - selftest_before))" 1 \
  "a fixture command failing inside a subshell is counted"

( git_q init --bare "$w/selftest.git" ) >/dev/null
expect_eq "$(($(wc -l <"$FIXTURE_FAILURES") - selftest_before))" 1 \
  "a fixture command that works counts nothing more"

# The failure above is this file testing itself, so trim it back out
# instead of letting the tally count it. Truncating to the pre-test line
# count keeps any genuine fixture failure from earlier in the run.
head -n "$selftest_before" "$FIXTURE_FAILURES" >"$w/trimmed-record"
mv "$w/trimmed-record" "$FIXTURE_FAILURES"
expect_eq "$(wc -l <"$FIXTURE_FAILURES")" "$selftest_before" \
  "the self-test's own fixture failure is not tallied"

# A backstop for every test that did not assert launch-free-ness itself:
# no test in this file should ever reach a launch without naming a stub,
# so a tripwire record surviving to here is a failure wherever it came
# from. Fails late and unattributed by design — the point is that the
# escape can no longer be silent, not that this is the best diagnostic.
expect_no_launch "no test reached an unstubbed launch"

echo
# git_q counts its failures on disk (see its definition): they can happen
# inside a subshell, where an increment of this variable would not
# survive the subshell's exit.
FAILURES=$((FAILURES + $(wc -l <"$FIXTURE_FAILURES")))
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) FAILED"
  exit 1
fi
echo "all tests passed"
