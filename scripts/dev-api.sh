#!/usr/bin/env bash
# Run the dev-stack API from a binary cache shared by every worktree
# (issue #304). scripts/dev.sh starts the API through this script instead of
# `cargo run`.
#
#   scripts/dev-api.sh [-- <api args>...]
#
# Why: each worktree used to build the API into its own api/target, so a
# fresh worktree's first stack spent 5-25 minutes compiling before a UI-only
# visual check could start. Now the built binary is cached by a hash of what
# it is built from — every non-ignored file under api/ in THIS worktree
# (uncommitted edits included), `rustc -Vv`, the feature set and RUSTFLAGS:
#
#   hit   <cache>/bin/<key>/kari-website-api exists: exec it. No cargo, no
#         lock, nothing shared at run time — the normal case for a worktree
#         whose api/ matches one already built.
#   miss  take <cache>/build.lock, build with CARGO_TARGET_DIR=<cache>/target
#         (so third-party crates are reused; the local crate is always
#         cleaned and rebuilt from this worktree's source, since cargo's
#         freshness check for it is mtime-based), and publish the binary
#         under the key only if the source did not change during the build.
#
# A stack never runs the shared target/debug binary, only a copy named by
# its own source hash, so it cannot pick up another branch's build.
#
# Environment:
#   KARI_API_CACHE_DIR     cache root (default
#                          ${XDG_CACHE_HOME:-~/.cache}/kari-website/api);
#                          deleting it is always safe
#   KARI_API_CACHE_KEEP    binaries kept, most recently used first (3)
#   KARI_API_CACHE_MAX_MB  the shared target is wiped before a build when it
#                          is larger than this (4000)
#
# Tests: scripts/dev-api-test.sh
set -euo pipefail

usage="usage: scripts/dev-api.sh [-- <api args>...]"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      echo "$usage"
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "unknown option: $1 ($usage)" >&2
      exit 1
      ;;
  esac
done

cd "$(dirname "$0")/.."

for cmd in cargo rustc git flock setsid sha256sum; do
  command -v "$cmd" > /dev/null || {
    echo "$cmd is required but not installed" >&2
    exit 1
  }
done

cache="${KARI_API_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/kari-website/api}"
keep="${KARI_API_CACHE_KEEP:-3}"
max_mb="${KARI_API_CACHE_MAX_MB:-4000}"
features=dev-auth
bin_name=kari-website-api
target="$cache/target"

# The cache key: a hash of everything the binary is built from. Deleted
# tracked files are still listed by `git ls-files -c`; their absence is part
# of the key rather than an error from hashing a missing file.
api_key() {
  local files=() present=() f
  mapfile -d '' files < <(git ls-files -co --exclude-standard -z -- api |
    sort -z)
  for f in "${files[@]}"; do
    if [ -f "$f" ]; then
      present+=("$f")
    else
      printf 'deleted %s\n' "$f"
    fi
  done > "$key_input"
  {
    echo "features=$features"
    echo "rustflags=${RUSTFLAGS:-}"
    rustc -Vv
    cat "$key_input"
    if [ "${#present[@]}" -gt 0 ]; then
      sha256sum -- "${present[@]}"
    fi
  } | sha256sum | cut -c1-32
}

key_input="$(mktemp)"
child=
staging=
on_exit() {
  rm -f "$key_input"
  if [ -n "$staging" ]; then rm -rf "$staging"; fi
}
trap on_exit EXIT

key="$(api_key)"
bin="$cache/bin/$key/$bin_name"

run_api() { # exec the cached binary; never returns
  rm -f "$key_input"
  trap - EXIT INT TERM
  # The LRU stamp the pruning below sorts by.
  touch "$cache/bin/$key"
  exec "$bin" "$@"
}

if [ -x "$bin" ]; then
  run_api "$@"
fi

# --- miss: build under the lock -------------------------------------------

mkdir -p "$cache/bin"
exec {lock_fd}> "$cache/build.lock"
if ! flock -n "$lock_fd"; then
  echo "Waiting for another worktree's API build to finish ($cache)..." >&2
  flock "$lock_fd"
fi

# Another worktree may have built the same source while this one waited.
if [ -x "$bin" ]; then
  exec {lock_fd}>&-
  run_api "$@"
fi

# Forward a stop to the whole build (cargo and its rustc children), so
# dev.sh's teardown during a build leaves no compile running against the
# shared target after the lock is released.
on_signal() {
  if [ -n "$child" ]; then
    kill -TERM -- "-$child" 2> /dev/null || true
    wait "$child" 2> /dev/null || true
  fi
  exit 143
}
trap on_signal INT TERM

# cargo in its own process group (setsid) so on_signal can stop all of it,
# without the lock fd (a surviving child must not hold the lock), and without
# KARI_COMMIT_SHA: api/src/routes/version.rs bakes it in with option_env!,
# and a local binary must keep reporting none.
run_cargo() {
  local rc=0
  env -u KARI_COMMIT_SHA CARGO_TARGET_DIR="$target" \
    setsid cargo "$@" {lock_fd}>&- &
  child=$!
  wait "$child" || rc=$?
  child=
  return "$rc"
}

# Leftovers of a build that was killed outright; only the lock holder
# creates these.
rm -rf "$cache/bin"/.staging-*

if [ -d "$target" ] &&
  [ "$(du -sm "$target" | cut -f1)" -gt "$max_mb" ]; then
  echo "The shared API build cache is over ${max_mb}MB; clearing it." >&2
  rm -rf "$target"
fi

attempt=1
while true; do
  echo "Building the API (cached for every worktree with this api/ source;" \
    "the first build takes several minutes)..." >&2
  run_cargo clean -p "$bin_name" --manifest-path api/Cargo.toml
  run_cargo build --manifest-path api/Cargo.toml --features "$features"
  new_key="$(api_key)"
  [ "$new_key" = "$key" ] && break
  if [ "$attempt" -ge 2 ]; then
    echo "api/ kept changing during the build; not caching it." >&2
    exit 1
  fi
  echo "api/ changed during the build; building again." >&2
  attempt=$((attempt + 1))
  key="$new_key"
  bin="$cache/bin/$key/$bin_name"
  if [ -x "$bin" ]; then
    exec {lock_fd}>&-
    run_api "$@"
  fi
done

staging="$cache/bin/.staging-$$"
mkdir "$staging"
cp "$target/debug/$bin_name" "$staging/"
rm -rf "${cache:?}/bin/${key:?}"
mv -T "$staging" "$cache/bin/$key"
staging=
touch "$cache/bin/$key"

# Keep the most recently used binaries; a running one can be deleted safely.
find "$cache/bin" -mindepth 1 -maxdepth 1 -type d ! -name '.*' \
  -printf '%T@ %p\n' | sort -rn | tail -n +"$((keep + 1))" | cut -d' ' -f2- |
  while IFS= read -r old; do
    rm -rf "$old"
  done

exec {lock_fd}>&-
run_api "$@"
