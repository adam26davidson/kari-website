#!/usr/bin/env bash
# Test harness for scripts/setup-worktree.sh and for the delegation to it
# in scripts/dev.sh. Runs in CI (the shell-lint job) and locally; run it
# whenever either script changes:
#   bash scripts/setup-worktree-test.sh
#
# Each case builds a throwaway "repo" (scripts/ + ui/ with a lockfile) and
# runs the real script against stub `npm`/`npx`/`cargo`/`docker` on PATH, so
# the assertions are about what the script would actually invoke — no
# network, no install, no containers.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP="$HERE/setup-worktree.sh"
DEV="$HERE/dev.sh"
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
# The npx stub reproduces what a real `npx playwright install` prints when
# the browser cache is already warm on a distro Playwright has no dedicated
# build for: npm announcing the command, and Playwright's "BEWARE" banner
# once per candidate download URL. Both are noise the script should drop,
# and dropping both is what leaves a warm run with nothing to print at all
# (issue #300).
cat > "$STUB_BIN/npx" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npx $*" >>"$STUB_LOG"
echo "npm notice run kari-website@0.0.0 npx" >&2
echo "BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64."
echo "BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64."
echo "BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64."
EOF
cat > "$STUB_BIN/node" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: node $*" >>"$STUB_LOG"
EOF
# dev.sh shells out to these two as well. `docker` fails on purpose: the
# delegation under test happens before the stack starts, so a failing docker
# stops each dev.sh case right after setup — fast, offline, no containers.
cat > "$STUB_BIN/cargo" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: cargo $*" >>"$STUB_LOG"
EOF
cat > "$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: docker $*" >>"$STUB_LOG"
exit 1
EOF
chmod +x "$STUB_BIN/npm" "$STUB_BIN/npx" "$STUB_BIN/node" \
  "$STUB_BIN/cargo" "$STUB_BIN/docker"

# A second stub dir whose `npm ci` fails, for the error-propagation case.
FAIL_BIN="$(mktemp -d)"
WORKDIRS+=("$FAIL_BIN")
cp "$STUB_BIN/npx" "$STUB_BIN/node" "$STUB_BIN/cargo" \
  "$STUB_BIN/docker" "$FAIL_BIN/"
cat > "$FAIL_BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npm $*" >>"$STUB_LOG"
echo "npm ERR! stub failure" >&2
exit 1
EOF
chmod +x "$FAIL_BIN/npm" "$FAIL_BIN/npx" "$FAIL_BIN/node" \
  "$FAIL_BIN/cargo" "$FAIL_BIN/docker"

# A stub dir whose `npx` also downloads, for checking that the filter keeps
# what a cold run has to say.
NPX_COLD_BIN="$(mktemp -d)"
WORKDIRS+=("$NPX_COLD_BIN")
cp "$STUB_BIN/npm" "$STUB_BIN/node" "$STUB_BIN/cargo" \
  "$STUB_BIN/docker" "$NPX_COLD_BIN/"
cat > "$NPX_COLD_BIN/npx" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npx $*" >>"$STUB_LOG"
echo "npm notice run kari-website@0.0.0 npx" >&2
echo "BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64."
echo "Downloading Chromium 140.0.1 from https://cdn.playwright.dev"
echo "Chromium 140.0.1 downloaded to /home/u/.cache/ms-playwright/chromium-1200"
EOF
chmod +x "$NPX_COLD_BIN/npm" "$NPX_COLD_BIN/npx" "$NPX_COLD_BIN/node" \
  "$NPX_COLD_BIN/cargo" "$NPX_COLD_BIN/docker"

# A stub dir whose `npx` fails, so the browser step's output filtering can be
# checked for swallowing a real failure.
NPX_FAIL_BIN="$(mktemp -d)"
WORKDIRS+=("$NPX_FAIL_BIN")
cp "$STUB_BIN/npm" "$STUB_BIN/node" "$STUB_BIN/cargo" \
  "$STUB_BIN/docker" "$NPX_FAIL_BIN/"
cat > "$NPX_FAIL_BIN/npx" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npx $*" >>"$STUB_LOG"
echo "Error: Failed to download Chromium" >&2
exit 1
EOF
chmod +x "$NPX_FAIL_BIN/npm" "$NPX_FAIL_BIN/npx" "$NPX_FAIL_BIN/node" \
  "$NPX_FAIL_BIN/cargo" "$NPX_FAIL_BIN/docker"

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
  cp "$DEV" "$repo/scripts/dev.sh"
  chmod +x "$repo/scripts/setup-worktree.sh" "$repo/scripts/dev.sh"
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

run_dev() { # <repo> [args...] — stdout+stderr in <repo>/out
  local repo="$1"
  shift
  # Both ports are pinned so dev.sh never probes for a free one (the node
  # stub cannot report a port), and `timeout` keeps a regression that hangs
  # the stack from hanging this harness.
  STUB_LOG="$repo/stub.log" PATH="${STUB_PATH:-$STUB_BIN}:$PATH" \
    KARI_API_PORT=31000 KARI_MINIO_PORT=39000 \
    timeout 60 bash "$repo/scripts/dev.sh" "$@" > "$repo/out" 2>&1
  echo $? > "$repo/exit-code"
}

expect_before() { # <file> <first> <second> <test-name>
  local a b
  a="$(grep -nF -- "$2" "$1" 2> /dev/null | head -1 | cut -d: -f1)"
  b="$(grep -nF -- "$3" "$1" 2> /dev/null | head -1 | cut -d: -f1)"
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then
    echo "ok: $4"
  else
    echo "FAIL: $4 — '$2' does not precede '$3' in $1:"
    sed 's/^/    /' "$1" 2> /dev/null || echo "    (missing file)"
    FAILURES=$((FAILURES + 1))
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
expect_not_contains "$r/out" "BEWARE: your OS is not officially supported" \
  "Playwright's unsupported-OS banner is filtered out"
expect_not_contains "$r/out" "npm notice run" \
  "npx's own command announcement is filtered out"

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

# 9. The filter is narrow: a cold run's download reporting still comes
#    through, so a long install is never unexplained silence.
r="$(new_repo)"
STUB_PATH="$NPX_COLD_BIN" run_setup "$r"
expect_contains "$r/out" "Downloading Chromium" \
  "a cold browser install still reports the download"
expect_contains "$r/out" "downloaded to" \
  "a cold browser install still reports where the build landed"

# 10. Filtering the browser step's output must not swallow a real failure:
#     the error text still shows and the script exits non-zero.
r="$(new_repo)"
STUB_PATH="$NPX_FAIL_BIN" run_setup "$r"
expect_not_contains "$r/exit-code" "0" \
  "a failing browser install exits non-zero"
expect_contains "$r/out" "Failed to download Chromium" \
  "a failing browser install still reports why"

# 11. --quiet: a warm run has nothing to say, so it says nothing. dev.sh
#     uses this so a stack start is not preceded by a setup banner.
r="$(new_repo)"
run_setup "$r"
: > "$r/stub.log"
run_setup "$r" --quiet
expect_eq "$(wc -c < "$r/out")" 0 "--quiet prints nothing when there is no work"
expect_contains "$r/stub.log" "/ui: npx playwright install chromium" \
  "--quiet still runs the browser install"
expect_eq "$(cat "$r/exit-code")" 0 "--quiet exits 0"

# 12. --quiet still announces the slow step, so a minute of `npm ci` is
#     never unexplained silence.
r="$(new_repo)"
run_setup "$r" --quiet
expect_contains "$r/out" "Installing UI dependencies" \
  "--quiet still announces a real install"

# 13. --quiet composes with --force and is documented in the usage line.
r="$(new_repo)"
run_setup "$r" --force --quiet
expect_contains "$r/stub.log" "/ui: npm ci" "--force --quiet still reinstalls"
expect_eq "$(cat "$r/exit-code")" 0 "--force --quiet exits 0"
r="$(new_repo)"
run_setup "$r" --help
expect_contains "$r/out" "--quiet" "--help documents --quiet"

# --- scripts/dev.sh delegates its setup to setup-worktree.sh (issue #298) --

# 14. A dev stack in a fresh worktree gets the canonical setup: `npm ci` from
#    the lockfile (not a drift-prone `npm install`) plus the Playwright
#    browser, before anything in the stack starts.
r="$(new_repo)"
run_dev "$r"
expect_contains "$r/stub.log" "/ui: npm ci" "dev.sh installs deps with npm ci"
expect_not_contains "$r/stub.log" "npm install" \
  "dev.sh runs no lockfile-drifting npm install"
expect_contains "$r/stub.log" "/ui: npx playwright install chromium" \
  "dev.sh installs the chromium browser"
expect_before "$r/stub.log" "npm ci" "docker" \
  "dev.sh finishes setup before starting the stack"

# 15. Re-running the stack is cheap: the setup skip means no second npm ci.
: > "$r/stub.log"
run_dev "$r"
expect_not_contains "$r/stub.log" "npm ci" "a second dev.sh run skips npm ci"
expect_not_contains "$r/out" "up to date" \
  "a warm dev.sh start prints no setup banner"
expect_not_contains "$r/out" "BEWARE: your OS is not officially supported" \
  "a warm dev.sh start prints no Playwright unsupported-OS banner"

# 16. A failing setup aborts dev.sh instead of starting a half-built stack.
r="$(new_repo)"
STUB_PATH="$FAIL_BIN" run_dev "$r"
expect_not_contains "$r/exit-code" "0" "failed setup exits dev.sh non-zero"
expect_not_contains "$r/stub.log" "docker" \
  "failed setup stops dev.sh before the stack starts"

# 17. Argument handling still comes first, so --help stays instant.
r="$(new_repo)"
run_dev "$r" --help
expect_contains "$r/out" "usage: scripts/dev.sh" "dev.sh --help prints usage"
expect_eq "$(cat "$r/exit-code")" 0 "dev.sh --help exits 0"
expect_eq "$(wc -c < "$r/stub.log")" 0 "dev.sh --help runs no commands"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) FAILED"
  exit 1
fi
echo "all tests passed"
