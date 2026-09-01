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

# Temp dirs are recorded in a file rather than in a shell array because the
# helpers that create them are called as `x="$(new_repo)"` — a command
# substitution runs in a subshell, so an array append inside one is lost the
# moment it returns, and the dirs would outlive the run.
TMP_REGISTRY="$(mktemp)"
cleanup() {
  while read -r d; do
    [ -n "$d" ] && rm -rf "$d"
  done < "$TMP_REGISTRY"
  rm -f "$TMP_REGISTRY"
}
trap cleanup EXIT

tmpdir() { # → a fresh temp dir, removed when the harness exits
  local d
  d="$(mktemp -d)"
  echo "$d" >> "$TMP_REGISTRY"
  echo "$d"
}

STUB_BIN="$(tmpdir)"
# Stand-in for a long-running dev server. dev.sh's last act is to launch
# three of them and block in `wait -n`, so a stub that returned immediately
# would have dev.sh tear the whole stack down at once — and the assertions
# would then be racing that teardown for the log lines the other two servers
# had not written yet (green on a fast machine, red on a CI runner). Each
# server stub instead runs until the harness releases it by creating
# $STUB_STOP, so the tests wait for the stack rather than sample it. The
# deadline is a backstop: no stub outlives the harness even if the release
# never comes.
cat > "$STUB_BIN/stub-serve" <<'EOF'
#!/usr/bin/env bash
while [ "$SECONDS" -lt 60 ]; do
  [ -e "${STUB_STOP:-/nonexistent}" ] && exit 0
  sleep 0.05
done
echo "stub server: STUB_STOP was never created" >&2
exit 1
EOF
# Stub npm/npx: log "<cwd>: <argv>" and fake `npm ci`'s side effect (npm
# writes node_modules/.package-lock.json on every install).
cat > "$STUB_BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npm $*" >>"$STUB_LOG"
case "${1:-}" in
  ci)
    mkdir -p node_modules
    touch node_modules/.package-lock.json
    ;;
  # `npm run dev` / `npm run dev:admin` — vite dev servers, which run until
  # they are stopped.
  run) exec stub-serve ;;
esac
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
# dev.sh shells out to these two as well. `cargo run` is the API server, so
# it runs until stopped like the vite ones. `docker` fails on purpose: the
# delegation under test happens before the stack starts, so a failing docker
# stops each dev.sh case right after setup — fast, offline, no containers.
cat > "$STUB_BIN/cargo" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: cargo $*" >>"$STUB_LOG"
exec stub-serve
EOF
cat > "$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: docker $*" >>"$STUB_LOG"
exit 1
EOF
chmod +x "$STUB_BIN"/*

# Every other stub dir is this one with a command or two overridden, so they
# are copies: a stub added to the base is then available to all of them
# without being threaded through a list per dir.
clone_stubs() { # → a fresh copy of $STUB_BIN, to override in
  local dir
  dir="$(tmpdir)"
  cp "$STUB_BIN"/* "$dir/"
  chmod +x "$dir"/*
  echo "$dir"
}

# A second stub dir whose `npm ci` fails, for the error-propagation case.
FAIL_BIN="$(clone_stubs)"
cat > "$FAIL_BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npm $*" >>"$STUB_LOG"
echo "npm ERR! stub failure" >&2
exit 1
EOF
chmod +x "$FAIL_BIN/npm"

# A stub dir whose `npx` also downloads, for checking that the filter keeps
# what a cold run has to say.
NPX_COLD_BIN="$(clone_stubs)"
cat > "$NPX_COLD_BIN/npx" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npx $*" >>"$STUB_LOG"
echo "npm notice run kari-website@0.0.0 npx" >&2
echo "BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64."
echo "Downloading Chromium 140.0.1 from https://cdn.playwright.dev"
echo "Chromium 140.0.1 downloaded to /home/u/.cache/ms-playwright/chromium-1200"
EOF
chmod +x "$NPX_COLD_BIN/npx"

# A stub dir whose `npx` fails, so the browser step's output filtering can be
# checked for swallowing a real failure.
NPX_FAIL_BIN="$(clone_stubs)"
cat > "$NPX_FAIL_BIN/npx" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: npx $*" >>"$STUB_LOG"
echo "Error: Failed to download Chromium" >&2
exit 1
EOF
chmod +x "$NPX_FAIL_BIN/npx"

# A stub dir for --aws mode. The minio-mode docker stub fails on purpose, so
# every case above stops before the stack itself starts; --aws never calls
# docker, so with an `aws` that succeeds the run reaches the part that starts
# the API and the two UI dev servers — the only case that gets that far, and
# so the only one that uses the server stubs above.
AWS_BIN="$(clone_stubs)"
cat > "$AWS_BIN/aws" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: aws $*" >>"$STUB_LOG"
EOF
chmod +x "$AWS_BIN/aws"

# A stub dir with node but deliberately no npm, for the missing-tool case.
NO_NPM_BIN="$(tmpdir)"
cp "$STUB_BIN/node" "$NO_NPM_BIN/"
chmod +x "$NO_NPM_BIN/node"

new_repo() {
  local repo
  repo="$(tmpdir)"
  mkdir -p "$repo/scripts" "$repo/ui"
  cp "$SETUP" "$repo/scripts/setup-worktree.sh"
  cp "$DEV" "$repo/scripts/dev.sh"
  chmod +x "$repo/scripts/setup-worktree.sh" "$repo/scripts/dev.sh"
  echo '{"name":"ui"}' > "$repo/ui/package.json"
  echo '{"lockfileVersion":3}' > "$repo/ui/package-lock.json"
  : > "$repo/stub.log"
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

# A dev.sh run that gets as far as starting the stack does not end by itself
# — the API and both vite servers run until they are stopped — so it is
# always launched in the background. A case about the stack brackets its
# assertions with start_dev / stop_dev; a case that expects dev.sh to stop on
# its own uses run_dev.
DEV_PID=
start_dev() { # <repo> [args...] — launch dev.sh; stdout+stderr in <repo>/out
  local repo="$1"
  shift
  rm -f "$repo/stop"
  # Both ports are pinned so dev.sh never probes for a free one (the node
  # stub cannot report a port), and `timeout` keeps a regression that hangs
  # the stack from hanging this harness.
  STUB_LOG="$repo/stub.log" STUB_STOP="$repo/stop" \
    PATH="${STUB_PATH:-$STUB_BIN}:$PATH" \
    KARI_API_PORT=31000 KARI_MINIO_PORT=39000 \
    timeout 60 bash "$repo/scripts/dev.sh" "$@" > "$repo/out" 2>&1 &
  DEV_PID=$!
}

await_dev() { # <repo> — collect dev.sh's exit code
  wait "$DEV_PID"
  echo $? > "$1/exit-code"
}

run_dev() { # <repo> [args...] — run dev.sh to completion
  start_dev "$@"
  # These cases stop before the stack starts (docker fails, or the run is
  # --help). Releasing the server stubs anyway means a regression that did
  # start the stack fails on its assertions instead of sitting here until
  # `timeout` fires.
  : > "$1/stop"
  await_dev "$1"
}

stop_dev() { # <repo> — release the server stubs and wait for the teardown
  : > "$1/stop"
  await_dev "$1"
}

# Block until <file> contains every <line>, so an assertion about a running
# stack waits for the stack instead of sampling whatever has been logged so
# far. That sampling is exactly what passed on a fast machine and failed on a
# CI runner: dev.sh's teardown killed the vite subshells before they had
# exec'd npm. Returns non-zero if a line never arrives, and the assertions
# then report which one — the deadline here is well under the server stubs'
# own, so a genuine regression is reported by the assertion rather than by a
# stub giving up first.
wait_for_lines() { # <file> <line>...
  local file="$1" line missing deadline=$((SECONDS + 15))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    missing=
    for line in "$@"; do
      grep -qxF -- "$line" "$file" 2> /dev/null || missing=1
    done
    [ -z "$missing" ] && return 0
    sleep 0.05
  done
  return 1
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

# 17. The stack is the whole site: the admin app is a separate vite build
#     with its own dev server (#591), so dev.sh starts BOTH (issue #593).
#     Started without the admin one, the public header's "Admin" link — a
#     plain link out of the SPA — lands on nothing.
#     The three server lines are named once and used for both the wait and
#     the assertions, so the two can never drift apart.
r="$(new_repo)"
public_dev="$r/ui: npm run dev"
admin_dev="$r/ui: npm run dev:admin"
api_run="$r: cargo run --manifest-path api/Cargo.toml"
STUB_PATH="$AWS_BIN" start_dev "$r" --aws
wait_for_lines "$r/stub.log" "$public_dev" "$admin_dev" "$api_run"
stop_dev "$r"
expect_eq "$(grep -cxF "$public_dev" "$r/stub.log")" 1 \
  "dev.sh starts the public app's dev server"
expect_contains "$r/stub.log" "$admin_dev" \
  "dev.sh starts the admin app's dev server"
expect_contains "$r/stub.log" "$api_run" "dev.sh starts the API"
expect_contains "$r/out" "Admin:" "dev.sh names the admin URL at startup"
expect_eq "$(cat "$r/exit-code")" 0 "dev.sh exits 0 once the stack stops"

# 18. Argument handling still comes first, so --help stays instant.
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
