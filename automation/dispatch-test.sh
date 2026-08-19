#!/usr/bin/env bash
# Test harness for automation/dispatch.sh. Local-only (not wired into CI);
# run it whenever dispatch.sh changes:
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
    bash "$DISPATCH" "$@" >"$work/out" 2>&1
  echo $? >"$work/exit-code"
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

expect_not_contains() { # <file> <needle> <test-name>
  if grep -qF -- "$2" "$1" 2>/dev/null; then
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

# 1. Enabled agent that has never run is due.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
run_dispatch "$w" --dry-run
expect_contains "$w/out" "WOULD RUN issue-pipeline" \
  "dry-run: never-run enabled agent is due"

# 2. Disabled agent is skipped.
w="$(new_work)"
write_agent "$w" demo-agent.md demo-agent false 1h opus
run_dispatch "$w" --dry-run
expect_contains "$w/out" "skip demo-agent: disabled" "disabled agent skipped"

# 3. Agent that ran 60s ago with every: 1h is not due.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 60
run_dispatch "$w" --dry-run
expect_contains "$w/out" "not due" "recently-run agent is not due"
expect_not_contains "$w/out" "WOULD RUN" "recently-run agent not launched"

# 4. Agent that ran 2h ago with every: 1h is due again.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 7200
run_dispatch "$w" --dry-run
expect_contains "$w/out" "WOULD RUN issue-pipeline" \
  "agent past its interval is due"

# 4a. Drift guard (#276): a run that started slightly inside the polling
#     window must not push the next run a whole poll later. With the
#     default 120s tolerance, "interval - 60s" counts as due...
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline $((3600 - 60))
run_dispatch "$w" --dry-run
expect_contains "$w/out" "WOULD RUN issue-pipeline" \
  "agent within the due tolerance is due"

# 4b. ...while "interval - (tolerance + 60s)" is still not due.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline $((3600 - (120 + 60)))
run_dispatch "$w" --dry-run
expect_contains "$w/out" "not due" "agent outside the due tolerance is not due"
expect_not_contains "$w/out" "WOULD RUN" \
  "agent outside the due tolerance not launched"

# 4c. The tolerance is configurable: a widened one makes an agent due
#     that the default tolerance would have skipped.
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 1800
run_dispatch "$w" --dry-run
expect_contains "$w/out" "not due" "half-elapsed agent not due by default"
w="$(new_work)"
write_agent "$w" issue-pipeline.md issue-pipeline true 1h fable
ran_ago "$w" issue-pipeline 1800
DUE_TOLERANCE=2400 run_dispatch "$w" --dry-run
expect_contains "$w/out" "WOULD RUN issue-pipeline" \
  "due tolerance is configurable"

# 4d. A tolerance wider than the interval never makes an agent overdue
#     forever: an agent that just ran with every: 5m is still due (the
#     tolerance clamps to the interval), not an error.
w="$(new_work)"
write_agent "$w" fast-agent.md fast-agent true 5m opus
ran_ago "$w" fast-agent 1
DUE_TOLERANCE=3600 run_dispatch "$w" --dry-run
expect_contains "$w/out" "WOULD RUN fast-agent" \
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
  expect_contains "$w/out" "WOULD RUN issue-pipeline" \
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
expect_contains "$w/out" "paused" "PAUSE file reported"
expect_not_contains "$w/out" "WOULD RUN" "PAUSE file prevents launches"

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
expect_contains "$w/out" "SKIP" "broken agent file warned about"
expect_contains "$w/out" "WOULD RUN good-agent" \
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
STUB_CLAUDE="$STUB_DIR/claude-stub" run_dispatch "$w"
for _ in $(seq 50); do
  [ -s "$w/stub-out" ] && break
  sleep 0.1
done
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
expect_contains "$w/out" "not due" "agent not due right after a run"

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
STUB_CLAUDE="$STUB_DIR/claude-stub" run_dispatch "$w"
for _ in $(seq 50); do
  [ -s "$w/stub-out" ] && break
  sleep 0.1
done
expect_contains "$w/stub-out" "--fallback-model opus" \
  "launch passes the fallback model when configured"

w="$(new_work)"
write_agent "$w" no-fallback.md no-fallback true 1h opus
export STUB_OUT="$w/stub-out"
STUB_CLAUDE="$STUB_DIR/claude-stub" run_dispatch "$w"
for _ in $(seq 50); do
  [ -s "$w/stub-out" ] && break
  sleep 0.1
done
expect_not_contains "$w/stub-out" "--fallback-model" \
  "no fallback flag when frontmatter omits it"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) FAILED"
  exit 1
fi
echo "all tests passed"
