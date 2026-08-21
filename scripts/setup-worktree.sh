#!/usr/bin/env bash
# One-command fresh-worktree setup (issue #280).
#
#   scripts/setup-worktree.sh           install what a new worktree needs
#   scripts/setup-worktree.sh --force   reinstall UI deps unconditionally
#   scripts/setup-worktree.sh --quiet   say nothing when there is no work
#
# A new worktree shares nothing installable with the main clone, so UI
# tooling (tests, lint, e2e, the screenshot capture) dies immediately until
# two things exist. This script does both, and is safe to re-run:
#
#   1. ui/node_modules — `npm ci` from the lockfile. Skipped when the tree
#      already matches the lockfile, which is what keeps a re-run cheap.
#   2. The Playwright chromium build, needed by the visual check. Its cache
#      is global (~/.cache/ms-playwright), not per-worktree, so this is a
#      fast no-op unless the machine is fresh or Playwright was bumped.
#      Running it unconditionally is the point: nobody has to judge which
#      of those cases they are in.
#
# Output is quiet when healthy (issue #300). scripts/dev.sh runs this script
# on every stack start, so anything printed here is printed several times a
# day; unactionable chatter would train people to skim past the one line
# that does matter. Two things make that work: --quiet drops the progress
# banners on a run that had nothing to do, and the browser step filters out
# noise Playwright and npx print unconditionally (see below). The install
# scripts npm blocks are handled in ui/package.json instead — its
# "allowScripts" field records a deliberate decision for each dependency
# that ships one, so `npm ci` no longer ends with a seven-package warning.
#
# Tests: scripts/setup-worktree-test.sh
set -euo pipefail

cd "$(dirname "$0")/.."

usage="usage: scripts/setup-worktree.sh [--force] [--quiet]"

force=false
quiet=false
for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    --quiet) quiet=true ;;
    -h | --help)
      echo "$usage"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      echo "$usage" >&2
      exit 1
      ;;
  esac
done

# Progress chatter: suppressed by --quiet. Anything a caller must act on is
# echoed directly instead, so --quiet never hides a problem.
say() { [ "$quiet" = true ] || echo "$@"; }

for cmd in node npm npx; do
  command -v "$cmd" > /dev/null || {
    echo "$cmd is required but not installed" >&2
    exit 1
  }
done

cd ui

# npm rewrites node_modules/.package-lock.json on every install, so it is a
# stamp of what is actually installed: older than package-lock.json means
# the lockfile moved (branch switch, dependency bump) since the last run.
stamp=node_modules/.package-lock.json
if [ "$force" = true ]; then
  echo "Installing UI dependencies (--force)..."
  npm ci
elif [ -f "$stamp" ] && [ ! "package-lock.json" -nt "$stamp" ]; then
  say "UI dependencies are up to date."
else
  echo "Installing UI dependencies..."
  npm ci
fi

# Downloads only what is missing, and prints nothing at all when the cache
# already has the build. Run from ui/ so npx resolves the pinned local
# Playwright.
#
# Two things it does print every time are dropped here (issue #300):
#   - "BEWARE: your OS is not officially supported by Playwright" — once per
#     candidate download URL, i.e. three times, on any distro without a
#     dedicated build (Arch, for one). The fallback build it then uses is
#     the same one CI runs on, so there is nothing to act on.
#   - npx announcing the command it is about to run.
# Everything else survives — a cold run still reports each download, its
# progress bar and where the build landed, and errors still reach the
# terminal. `pipefail` keeps npx's exit status; the `|| true` only stops
# grep's "matched nothing" exit from being mistaken for a failed install.
say "Ensuring the Playwright chromium build is installed..."
npx playwright install chromium 2>&1 |
  { grep -vE '^(BEWARE: your OS is not officially supported|npm notice run )' \
    || true; }

say
say "Worktree ready: UI dependencies and the Playwright browser are in place."
