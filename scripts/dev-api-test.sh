#!/usr/bin/env bash
# Test harness for scripts/dev-api.sh, the shared API binary cache that
# scripts/dev.sh starts the API through (issue #304). Runs in CI (the
# shell-lint job) and locally; run it whenever dev-api.sh changes:
#   bash scripts/dev-api-test.sh
#
# Each case builds a throwaway git repo (scripts/dev-api.sh + a minimal api/)
# and runs the real script against stub `cargo`/`rustc` on PATH, with
# KARI_API_CACHE_DIR always pointing at a temp dir — never the real cache.
# The stub `cargo build` writes a fake API binary whose body embeds the
# current content of api/src/main.rs, so "which source did the binary that
# ran come from" is an assertion on the log line it writes.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/dev-api.sh"
FAILURES=0

# Temp dirs live in a file, not an array: the helpers that create them run in
# command substitutions (subshells), where an array append would be lost.
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
cat > "$STUB_BIN/rustc" <<'EOF'
#!/usr/bin/env bash
echo "${STUB_RUSTC_VERSION:-rustc 1.0.0-stub}"
EOF
# Stub cargo: logs "<cwd>: cargo <argv> target=<CARGO_TARGET_DIR>
# sha=<KARI_COMMIT_SHA or unset>". `build` can be made to fail
# (STUB_BUILD_FAIL), to block until $STUB_RELEASE exists after touching
# $STUB_BUILDING (so a case can act mid-build without sleeping), and to edit
# api/src/main.rs mid-build (STUB_MUTATE=once|always). Then it writes the fake
# binary, embedding main.rs as it is at the end of the build.
cat > "$STUB_BIN/cargo" <<'EOF'
#!/usr/bin/env bash
echo "$PWD: cargo $* target=${CARGO_TARGET_DIR:-} sha=${KARI_COMMIT_SHA-unset}" \
  >>"$STUB_LOG"
[ "${1:-}" = build ] || exit 0
if [ -n "${STUB_RELEASE:-}" ]; then
  # The wait runs in a child process, as real compiles run in rustc children
  # of cargo, so a stop that reaches cargo alone is caught.
  bash -c 'while [ ! -e "$1" ] && [ "$SECONDS" -lt 30 ]; do sleep 0.05; done' \
    _ "$STUB_RELEASE" &
  echo "$$ $!" > "${STUB_PIDFILE:-/dev/null}"
  if [ -n "${STUB_BUILDING:-}" ]; then : > "$STUB_BUILDING"; fi
  wait
  # Reached only if nothing stopped the build: the release never came.
  [ -e "$STUB_RELEASE" ] || echo "stub build: never released" >>"$STUB_LOG"
fi
if [ -n "${STUB_BUILD_FAIL:-}" ]; then
  echo "error: stub compile failure" >&2
  exit 101
fi
case "${STUB_MUTATE:-}" in
  always) echo "// edit $RANDOM$RANDOM" >> api/src/main.rs ;;
  once)
    if [ ! -e "$STUB_LOG.mutated" ]; then
      : > "$STUB_LOG.mutated"
      echo "// edited mid-build" >> api/src/main.rs
    fi
    ;;
esac
marker="$(tr '\n' ' ' < api/src/main.rs)"
mkdir -p "$CARGO_TARGET_DIR/debug"
out="$CARGO_TARGET_DIR/debug/kari-website-api"
{
  echo '#!/usr/bin/env bash'
  printf 'echo "api ran: %s from $0 args: $*" >> "$STUB_LOG"\n' "$marker"
} > "$out"
chmod +x "$out"
EOF
chmod +x "$STUB_BIN"/*

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

# Block until <file> exists / contains <needle>, so a mid-build assertion
# waits for the state instead of sampling it.
wait_for() { # <file> [needle]
  local deadline=$((SECONDS + 15))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ -e "$1" ] && { [ -z "${2:-}" ] || grep -qF -- "$2" "$1"; }; then
      return 0
    fi
    sleep 0.05
  done
  echo "    (timed out waiting for ${2:-$1})"
  return 1
}

count() { # <file> <needle> → number of lines containing it
  grep -cF -- "$2" "$1" 2> /dev/null || true
}

# A git repo with the script and a minimal crate, its api/ staged so
# `git ls-files -c` sees it. <marker> is api/src/main.rs's content.
new_repo() { # <marker>
  local repo
  repo="$(tmpdir)"
  mkdir -p "$repo/scripts" "$repo/api/src"
  cp "$SCRIPT" "$repo/scripts/dev-api.sh"
  chmod +x "$repo/scripts/dev-api.sh"
  printf '[package]\nname = "kari-website-api"\n' > "$repo/api/Cargo.toml"
  printf 'target/\n' > "$repo/api/.gitignore"
  echo "$1" > "$repo/api/src/main.rs"
  git -C "$repo" init -q
  git -C "$repo" add api
  : > "$repo/stub.log"
  echo "$repo"
}

# Run the script to completion against <cache>: stdout+stderr in <repo>/out,
# exit code in <repo>/exit-code.
run_api() { # <repo> <cache> [args...]
  local repo="$1" cache="$2"
  shift 2
  STUB_LOG="$repo/stub.log" PATH="$STUB_BIN:$PATH" \
    KARI_API_CACHE_DIR="$cache" timeout 60 \
    bash "$repo/scripts/dev-api.sh" "$@" > "$repo/out" 2>&1
  echo $? > "$repo/exit-code"
}

BG_PID=
start_api() { # <repo> <cache> [args...] — like run_api, in the background
  local repo="$1" cache="$2"
  shift 2
  STUB_LOG="$repo/stub.log" PATH="$STUB_BIN:$PATH" \
    KARI_API_CACHE_DIR="$cache" \
    bash "$repo/scripts/dev-api.sh" "$@" > "$repo/out" 2>&1 &
  BG_PID=$!
}

key_dirs() { # <cache> → number of published binaries
  find "$1/bin" -mindepth 1 -maxdepth 1 -type d ! -name '.*' 2> /dev/null |
    wc -l
}

reset() { # <repo>
  : > "$1/stub.log"
}

# 1. A miss builds into the shared target with the dev-auth feature and this
#    repo's manifest, cleaning the local crate first, then runs the copy
#    published under bin/ — never the shared target/debug binary.
c="$(tmpdir)"
r="$(new_repo A)"
run_api "$r" "$c" -- --flag
expect_eq "$(cat "$r/exit-code")" 0 "a miss exits 0 once the API exits"
expect_contains "$r/stub.log" \
  "$r: cargo clean -p kari-website-api --manifest-path api/Cargo.toml target=$c/target" \
  "a miss cleans the local crate in the shared target"
expect_contains "$r/stub.log" \
  "$r: cargo build --manifest-path api/Cargo.toml --features dev-auth target=$c/target" \
  "a miss builds with dev-auth into the shared target"
expect_before "$r/stub.log" "cargo clean" "cargo build" \
  "the clean comes before the build"
expect_contains "$r/stub.log" "api ran: A  from $c/bin/" \
  "the binary that runs is the published copy"
expect_not_contains "$r/stub.log" "from $c/target" \
  "the shared target's binary is never run"
expect_contains "$r/stub.log" "args: --flag" \
  "arguments after -- reach the API"
expect_contains "$r/out" "Building the API" "a miss announces the build"

# 2. A second run is a hit: no cargo at all, nothing printed.
reset "$r"
run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo")" 0 "a hit runs no cargo"
expect_eq "$(wc -c < "$r/out")" 0 "a hit prints nothing"
expect_contains "$r/stub.log" "api ran: A " "a hit runs the cached binary"

# 3. An edit with a BACKDATED mtime still rebuilds: the key is content, not
#    timestamps.
reset "$r"
echo A2 > "$r/api/src/main.rs"
touch -d '2000-01-01' "$r/api/src/main.rs"
run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo build")" 1 \
  "a backdated content edit rebuilds"
expect_contains "$r/stub.log" "api ran: A2 " \
  "the rebuilt binary carries the edit"

# 4. Two worktrees with different source share one cache: each runs its own
#    build, and B's build does not change what A runs.
reset "$r"
b="$(new_repo B)"
run_api "$b" "$c"
expect_contains "$b/stub.log" "api ran: B " "worktree B runs B's source"
run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo")" 0 \
  "worktree A is still a hit after B built"
expect_contains "$r/stub.log" "api ran: A2 " "worktree A still runs A's source"

# 5. Two worktrees with identical api/ share one build.
c="$(tmpdir)"
r="$(new_repo same)"
b="$(new_repo same)"
run_api "$r" "$c"
run_api "$b" "$c"
expect_eq "$(count "$b/stub.log" "cargo")" 0 \
  "identical source in another worktree is a hit"
expect_contains "$b/stub.log" "api ran: same " \
  "the other worktree runs the shared binary"

# 6. What counts as source: an untracked file under api/ does; an ignored
#    file and a file outside api/ do not.
reset "$r"
echo junk > "$r/notes.txt"
mkdir -p "$r/api/target"
echo junk > "$r/api/target/x"
run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo")" 0 \
  "ignored files and files outside api/ do not change the key"
echo 'mod extra;' > "$r/api/src/extra.rs"
run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo build")" 1 \
  "an untracked file under api/ changes the key"

# 7. A tracked file deleted from the working tree neither crashes the key nor
#    leaves it unchanged.
reset "$r"
rm "$r/api/.gitignore"
run_api "$r" "$c"
expect_eq "$(cat "$r/exit-code")" 0 "a deleted tracked file does not crash"
expect_eq "$(count "$r/stub.log" "cargo build")" 1 \
  "a deleted tracked file changes the key"

# 8. A different toolchain changes the key.
reset "$r"
STUB_RUSTC_VERSION="rustc 2.0.0-stub" run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo build")" 1 \
  "a different rustc -Vv changes the key"

# 9. A failing build exits non-zero, publishes nothing, and the next run
#    tries again.
c="$(tmpdir)"
r="$(new_repo fail)"
STUB_BUILD_FAIL=1 run_api "$r" "$c"
expect_eq "$(cat "$r/exit-code")" 101 "a failing build exits with its status"
expect_eq "$(key_dirs "$c")" 0 "a failing build publishes nothing"
expect_contains "$r/out" "stub compile failure" "the build error is shown"
reset "$r"
run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo build")" 1 \
  "the run after a failed build builds again"

# 10. Source edited during the build is not published under the stale key:
#     the script builds once more and publishes the new source's key.
c="$(tmpdir)"
r="$(new_repo before)"
STUB_MUTATE=once run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo build")" 2 \
  "an edit during the build triggers one rebuild"
expect_eq "$(key_dirs "$c")" 1 "only the new source's key is published"
reset "$r"
run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo")" 0 \
  "the published key matches the edited source"
expect_contains "$r/stub.log" "edited mid-build" \
  "the published binary carries the edit"
#     ...and source that keeps changing is never cached.
c="$(tmpdir)"
r="$(new_repo churn)"
STUB_MUTATE=always run_api "$r" "$c"
expect_eq "$(cat "$r/exit-code")" 1 "source that keeps changing fails"
expect_eq "$(key_dirs "$c")" 0 "source that keeps changing is not cached"

# 11. Two simultaneous misses for one key: one build, the second waits (and
#     says so), then runs the same binary.
c="$(tmpdir)"
r="$(new_repo race)"
b="$(new_repo race)"
export STUB_BUILDING="$c.building" STUB_RELEASE="$c.release"
start_api "$r" "$c"
pid_a=$BG_PID
wait_for "$STUB_BUILDING"
start_api "$b" "$c"
pid_b=$BG_PID
wait_for "$b/out" "Waiting for another worktree's API build"
: > "$STUB_RELEASE"
wait "$pid_a"
wait "$pid_b"
unset STUB_BUILDING STUB_RELEASE
expect_eq "$(cat "$r/stub.log" "$b/stub.log" | grep -cF "cargo build")" 1 \
  "simultaneous misses for one key build once"
expect_contains "$b/out" "Waiting for another worktree's API build" \
  "the waiting worktree says it is waiting"
expect_contains "$b/stub.log" "api ran: race  from $c/bin/" \
  "the waiting worktree runs the first one's build"

# 12. TERM during a build stops the compile and publishes nothing.
c="$(tmpdir)"
r="$(new_repo term)"
export STUB_BUILDING="$c.building" STUB_RELEASE="$c.never" \
  STUB_PIDFILE="$c.pid"
start_api "$r" "$c"
wait_for "$STUB_BUILDING"
kill -TERM "$BG_PID"
wait "$BG_PID"
expect_eq "$?" 143 "TERM during a build exits 143"
unset STUB_BUILDING STUB_RELEASE STUB_PIDFILE
read -r cargo_pid compile_pid < "$c.pid"
for p in "cargo:$cargo_pid" "its compile child:$compile_pid"; do
  if kill -0 "${p##*:}" 2> /dev/null; then
    echo "FAIL: TERM during a build leaves ${p%:*} running"
    FAILURES=$((FAILURES + 1))
    kill "${p##*:}"
  else
    echo "ok: TERM during a build stops ${p%:*}"
  fi
done
expect_not_contains "$r/stub.log" "never released" \
  "TERM during a build stops it at once, not at the stub's deadline"
expect_eq "$(key_dirs "$c")" 0 "TERM during a build publishes nothing"
rm -f "$c.building" "$c.pid"

# 13. A caller's KARI_COMMIT_SHA never reaches the build (version.rs bakes it
#     in; a local binary must report none).
c="$(tmpdir)"
r="$(new_repo sha)"
KARI_COMMIT_SHA=deadbeef run_api "$r" "$c"
expect_contains "$r/stub.log" "cargo build --manifest-path api/Cargo.toml --features dev-auth target=$c/target sha=unset" \
  "KARI_COMMIT_SHA is not visible to cargo"

# 14. Pruning: KARI_API_CACHE_KEEP bounds the binaries (most recent kept),
#     KARI_API_CACHE_MAX_MB wipes an oversized shared target before building.
c="$(tmpdir)"
r="$(new_repo keep1)"
run_api "$r" "$c"
old="$(find "$c/bin" -mindepth 1 -maxdepth 1 -type d ! -name '.*')"
echo keep2 > "$r/api/src/main.rs"
KARI_API_CACHE_KEEP=1 run_api "$r" "$c"
expect_eq "$(key_dirs "$c")" 1 "KARI_API_CACHE_KEEP=1 keeps one binary"
if [ -d "$old" ]; then
  echo "FAIL: the older binary was kept instead of the new one"
  FAILURES=$((FAILURES + 1))
else
  echo "ok: the older binary is the one pruned"
fi
reset "$r"
run_api "$r" "$c"
expect_eq "$(count "$r/stub.log" "cargo")" 0 "the just-built binary is kept"
echo junk > "$c/target/junk"
echo keep3 > "$r/api/src/main.rs"
KARI_API_CACHE_MAX_MB=0 run_api "$r" "$c"
if [ -e "$c/target/junk" ]; then
  echo "FAIL: an oversized shared target is not wiped"
  FAILURES=$((FAILURES + 1))
else
  echo "ok: an oversized shared target is wiped before the build"
fi
expect_contains "$r/out" "clearing it" "wiping the shared target says so"
expect_contains "$r/stub.log" "api ran: keep3 " \
  "the build after the wipe still runs"

# 15. Usage: --help and unknown options, like the other scripts, and a
#     missing tool is named.
c="$(tmpdir)"
r="$(new_repo usage)"
run_api "$r" "$c" --help
expect_contains "$r/out" "usage: scripts/dev-api.sh" "--help prints usage"
expect_eq "$(cat "$r/exit-code")" 0 "--help exits 0"
expect_eq "$(wc -c < "$r/stub.log")" 0 "--help runs no commands"
run_api "$r" "$c" --wat
expect_contains "$r/out" "unknown option" "unknown option is reported"
expect_eq "$(cat "$r/exit-code")" 1 "unknown option exits 1"
expect_eq "$(wc -c < "$r/stub.log")" 0 "unknown option runs no commands"
NO_FLOCK_BIN="$(tmpdir)"
cp "$STUB_BIN/cargo" "$STUB_BIN/rustc" "$NO_FLOCK_BIN/"
for tool in dirname git setsid sha256sum; do
  ln -s "$(command -v "$tool")" "$NO_FLOCK_BIN/$tool"
done
STUB_LOG="$r/stub.log" PATH="$NO_FLOCK_BIN" KARI_API_CACHE_DIR="$c" \
  "$(command -v bash)" "$r/scripts/dev-api.sh" > "$r/out" 2>&1
echo $? > "$r/exit-code"
expect_contains "$r/out" "flock is required" "a missing flock is named"
expect_eq "$(cat "$r/exit-code")" 1 "a missing flock exits 1"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) FAILED"
  exit 1
fi
echo "all tests passed"
