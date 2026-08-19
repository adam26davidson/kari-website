#!/usr/bin/env bash
# Test harness for scripts/setup-worktree.sh. Local-only (not wired into
# CI); run it whenever setup-worktree.sh changes:
#   bash scripts/setup-worktree-test.sh
#
# Each case builds a throwaway "repo" (scripts/ + ui/ with a lockfile) and
# runs the real script against stub `npm`/`npx` on PATH, so the assertions
# are about what the script would actually invoke — no network, no install.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP="$HERE/setup-worktree.sh"
FAILURES=0
WORKDIRS=()

cleanup() {
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

# Stub npm/npx: log "<cwd>: <argv>" and fake `npm ci`'s side effect (npm
# writes node_modules/.package-lock.json on every install).
STUB_BIN="$(mktemp -d)"
WORKDIRS+=("$STUB_BIN")
cat > "$STUB_BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npm $*" >>"$STUB_LOG"
if [ "${1:-}" = ci ]; then
  mkdir -p node_modules
  touch node_modules/.package-lock.json
fi
EOF
cat > "$STUB_BIN/npx" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npx $*" >>"$STUB_LOG"
EOF
cat > "$STUB_BIN/node" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: node $*" >>"$STUB_LOG"
EOF
chmod +x "$STUB_BIN/npm" "$STUB_BIN/npx" "$STUB_BIN/node"

# A second stub dir whose `npm ci` fails, for the error-propagation case.
FAIL_BIN="$(mktemp -d)"
WORKDIRS+=("$FAIL_BIN")
cp "$STUB_BIN/npx" "$STUB_BIN/node" "$FAIL_BIN/"
cat > "$FAIL_BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npm $*" >>"$STUB_LOG"
echo "npm ERR! stub failure" >&2
exit 1
EOF
chmod +x "$FAIL_BIN/npm" "$FAIL_BIN/npx" "$FAIL_BIN/node"

# A stub dir with node but deliberately no npm, for the missing-tool case.
NO_NPM_BIN="$(mktemp -d)"
WORKDIRS+=("$NO_NPM_BIN")
cp "$STUB_BIN/node" "$NO_NPM_BIN/"
chmod +x "$NO_NPM_BIN/node"

new_repo() {
  local repo
  repo="$(mktemp -d)"
  mkdir -p "$repo/scripts" "$repo/ui"
  cp "$SETUP" "$repo/scripts/setup-worktree.sh"
  echo '{"name":"ui"}' > "$repo/ui/package.json"
  echo '{"lockfileVersion":3}' > "$repo/ui/package-lock.json"
  : > "$repo/stub.log"
  WORKDIRS+=("$repo")
  echo "$repo"
}

run_setup() { # <repo> [args...] — stdout+stderr in <repo>/out
  local repo="$1"
  shift
  STUB_LOG="$repo/stub.log" PATH="${STUB_PATH:-$STUB_BIN}:$PATH" \
    bash "$repo/scripts/setup-worktree.sh" "$@" > "$repo/out" 2>&1
  echo $? > "$repo/exit-code"
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

expect_not_contains() { # <file> <needle> <test-name>
  if grep -qF -- "$2" "$1" 2> /dev/null; then
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

# 1. Fresh worktree: both setup steps run, in ui/, and the script succeeds.
r="$(new_repo)"
run_setup "$r"
expect_contains "$r/stub.log" "/ui: npm ci" "fresh worktree runs npm ci in ui/"
expect_contains "$r/stub.log" "/ui: npx playwright install chromium" \
  "fresh worktree installs the chromium browser"
expect_eq "$(cat "$r/exit-code")" 0 "fresh worktree setup exits 0"

# 2. Re-run with dependencies already current: npm ci is skipped (that is
#    what makes the script cheap to run again), the browser step still runs
#    because it is its own no-op when the cache already has the build.
: > "$r/stub.log"
run_setup "$r"
expect_not_contains "$r/stub.log" "npm ci" "re-run skips an unnecessary npm ci"
expect_contains "$r/out" "up to date" "re-run says dependencies are current"
expect_contains "$r/stub.log" "/ui: npx playwright install chromium" \
  "re-run still runs the browser install"
expect_eq "$(cat "$r/exit-code")" 0 "re-run exits 0"

# 3. --force reinstalls even when the tree looks current.
: > "$r/stub.log"
run_setup "$r" --force
expect_contains "$r/stub.log" "/ui: npm ci" "--force reinstalls dependencies"
expect_eq "$(cat "$r/exit-code")" 0 "--force exits 0"

# 4. Lockfile changed since the last install: npm ci runs again.
r="$(new_repo)"
run_setup "$r"
: > "$r/stub.log"
touch "$r/ui/package-lock.json"
run_setup "$r"
expect_contains "$r/stub.log" "/ui: npm ci" \
  "changed lockfile triggers a reinstall"

# 5. A failing npm ci aborts with a non-zero exit and no browser install.
r="$(new_repo)"
STUB_PATH="$FAIL_BIN" run_setup "$r"
expect_not_contains "$r/exit-code" "0" "failed npm ci exits non-zero"
expect_not_contains "$r/stub.log" "playwright" \
  "failed npm ci stops before the browser install"

# 6. --help documents usage without touching anything.
r="$(new_repo)"
run_setup "$r" --help
expect_contains "$r/out" "usage: scripts/setup-worktree.sh" \
  "--help prints usage"
expect_eq "$(cat "$r/exit-code")" 0 "--help exits 0"
expect_eq "$(wc -c < "$r/stub.log")" 0 "--help runs no commands"

# 7. Missing npm is reported clearly instead of failing deep in the script.
#    PATH is the stub dir alone, so bash needs its absolute path here.
BASH_ABS="$(command -v bash)"
r="$(new_repo)"
PATH="$NO_NPM_BIN" STUB_LOG="$r/stub.log" \
  "$BASH_ABS" "$r/scripts/setup-worktree.sh" > "$r/out" 2>&1
echo $? > "$r/exit-code"
expect_contains "$r/out" "npm" "missing npm names the missing tool"
expect_not_contains "$r/exit-code" "0" "missing npm exits non-zero"

# 8. Unknown options are rejected rather than silently ignored.
r="$(new_repo)"
run_setup "$r" --wat
expect_contains "$r/out" "unknown option" "unknown option is reported"
expect_not_contains "$r/exit-code" "0" "unknown option exits non-zero"
expect_eq "$(wc -c < "$r/stub.log")" 0 "unknown option runs no commands"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) FAILED"
  exit 1
fi
echo "all tests passed"
