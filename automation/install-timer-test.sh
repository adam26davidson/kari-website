#!/usr/bin/env bash
# Test harness for automation/install-timer.sh. Runs in CI (the shell-lint
# job) and locally; run it whenever install-timer.sh or the unit files in
# automation/systemd/ change:
#   bash automation/install-timer-test.sh
#
# Hermetic by construction: every run points KARI_SYSTEMD_USER_DIR at a
# temp dir and KARI_SYSTEMCTL_BIN at a recording stub, so the harness can
# never write to ~/.config/systemd/user or poke the live timer.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="$HERE/install-timer.sh"
FAILURES=0
WORKDIRS=()

cleanup() {
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

# The main clone's dispatch.sh — what a rendered unit must point at even
# when the script is run from a linked worktree. Derived from
# --git-common-dir rather than the `git worktree list` the script itself
# uses, so the assertion is an independent answer, not an echo.
main_dispatch() {
  local common
  common="$(git -C "$HERE" rev-parse --path-format=absolute \
    --git-common-dir 2> /dev/null)" || return 1
  echo "$(dirname "$common")/automation/dispatch.sh"
}

new_work() { # a temp dir with an empty unit dir and a systemctl stub
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/units"
  cat > "$work/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
EOF
  chmod +x "$work/systemctl"
  : > "$work/stub.log"
  WORKDIRS+=("$work")
  echo "$work"
}

run_install() { # <workdir> [args...] — output in <workdir>/out
  local work="$1"
  shift
  STUB_LOG="$work/stub.log" \
  KARI_SYSTEMD_USER_DIR="$work/units" \
  KARI_SYSTEMCTL_BIN="$work/systemctl" \
    bash "$INSTALL" "$@" > "$work/out" 2>&1
  echo $? > "$work/exit-code"
}

expect_eq() { # <actual> <expected> <test-name>
  if [ "$1" = "$2" ]; then
    echo "ok: $3"
  else
    echo "FAIL: $3 — expected '$2', got '$1'"
    FAILURES=$((FAILURES + 1))
  fi
}

expect_contains() { # <file> <needle> <test-name>
  if grep -qF -- "$2" "$1" 2> /dev/null; then
    echo "ok: $3"
  else
    echo "FAIL: $3 — no '$2' in $1:"
    sed 's/^/    /' "$1" 2> /dev/null || echo "    (missing file)"
    FAILURES=$((FAILURES + 1))
  fi
}

# A missing file is a failure, not an absence: otherwise every
# expect_not_contains passes for free on a run that wrote nothing.
expect_not_contains() { # <file> <needle> <test-name>
  if [ ! -e "$1" ]; then
    echo "FAIL: $3 — expected file $1 (cannot assert '$2' is absent)"
    FAILURES=$((FAILURES + 1))
  elif grep -qF -- "$2" "$1" 2> /dev/null; then
    echo "FAIL: $3 — unexpected '$2' in $1"
    FAILURES=$((FAILURES + 1))
  else
    echo "ok: $3"
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

# 1. --help documents the interface and changes nothing.
w="$(new_work)"
run_install "$w" --help
expect_eq "$(cat "$w/exit-code")" 0 "--help exits 0"
expect_contains "$w/out" "--dry-run" "--help mentions --dry-run"
expect_eq "$(find "$w/units" -type f | wc -l)" 0 "--help writes no units"
expect_eq "$(wc -c < "$w/stub.log")" 0 "--help runs no systemctl"

# 2. An unknown option is refused rather than half-applied.
w="$(new_work)"
run_install "$w" --frobnicate
expect_eq "$(cat "$w/exit-code")" 1 "unknown option exits 1"
expect_eq "$(find "$w/units" -type f | wc -l)" 0 \
  "unknown option writes no units"
expect_eq "$(wc -c < "$w/stub.log")" 0 "unknown option runs no systemctl"

# 3. --dry-run reports what it would do and touches nothing.
w="$(new_work)"
run_install "$w" --dry-run
expect_eq "$(cat "$w/exit-code")" 0 "--dry-run exits 0"
expect_contains "$w/out" "kari-automation.service" \
  "--dry-run names the service unit"
expect_contains "$w/out" "kari-automation.timer" \
  "--dry-run names the timer unit"
expect_contains "$w/out" "daemon-reload" \
  "--dry-run names the systemctl commands it would run"
expect_eq "$(find "$w/units" -type f | wc -l)" 0 "--dry-run writes no units"
expect_eq "$(wc -c < "$w/stub.log")" 0 "--dry-run runs no systemctl"

# 4. A real install writes both units into the unit dir.
w="$(new_work)"
run_install "$w"
expect_eq "$(cat "$w/exit-code")" 0 "install exits 0"
expect_file "$w/units/kari-automation.service" "install writes the service"
expect_file "$w/units/kari-automation.timer" "install writes the timer"

# 5. The timer is the committed file verbatim — no drift to review.
if diff -q "$HERE/systemd/kari-automation.timer" \
  "$w/units/kari-automation.timer" > /dev/null 2>&1; then
  echo "ok: installed timer matches the committed unit byte for byte"
else
  echo "FAIL: installed timer differs from automation/systemd/"
  FAILURES=$((FAILURES + 1))
fi

# 6. The service's ExecStart is rendered to the main clone's dispatcher,
#    with no template placeholder left behind.
expect_contains "$w/units/kari-automation.service" \
  "ExecStart=$(main_dispatch)" "ExecStart points at the main clone"
expect_not_contains "$w/units/kari-automation.service" "{{" \
  "no unrendered placeholder in the service"

# 7. KillMode=process survives rendering: without it systemd kills the
#    backgrounded agent sessions when the oneshot exits.
expect_contains "$w/units/kari-automation.service" "KillMode=process" \
  "service keeps KillMode=process"

# 7a. The optional EnvironmentFile survives rendering: it is where the
#     Telegram bot token and chat id live (mode 600, never committed), and
#     without the line the fleet's alerts go nowhere while every unit test
#     stays green.
expect_contains "$w/units/kari-automation.service" \
  "EnvironmentFile=-%h/.config/kari-automation/env" \
  "service loads the optional Telegram env file"

# 8. The install reloads systemd and enables the timer.
expect_contains "$w/stub.log" "--user daemon-reload" \
  "install runs daemon-reload"
expect_contains "$w/stub.log" "--user enable --now kari-automation.timer" \
  "install enables the timer"

# 9. Re-running is a no-op that says so.
run_install "$w"
expect_eq "$(cat "$w/exit-code")" 0 "re-run exits 0"
expect_contains "$w/out" "unchanged" "re-run reports the units unchanged"

# 10. A drifted unit file is corrected.
w="$(new_work)"
echo "stale nonsense" > "$w/units/kari-automation.timer"
run_install "$w"
expect_eq "$(cat "$w/exit-code")" 0 "install over a stale unit exits 0"
expect_not_contains "$w/units/kari-automation.timer" "stale nonsense" \
  "a drifted unit is overwritten"
expect_contains "$w/out" "updated" "install reports the drifted unit updated"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) FAILED"
  exit 1
fi
echo "all tests passed"
