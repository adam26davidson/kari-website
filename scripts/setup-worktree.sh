#!/usr/bin/env bash
# One-command fresh-worktree setup (issue #280).
#
#   scripts/setup-worktree.sh           install what a new worktree needs
#   scripts/setup-worktree.sh --force   reinstall UI deps unconditionally
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
# Tests: scripts/setup-worktree-test.sh
set -euo pipefail

cd "$(dirname "$0")/.."

force=false
for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    -h | --help)
      echo "usage: scripts/setup-worktree.sh [--force]"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      echo "usage: scripts/setup-worktree.sh [--force]" >&2
      exit 1
      ;;
  esac
done

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
  echo "UI dependencies are up to date."
else
  echo "Installing UI dependencies..."
  npm ci
fi

# Downloads only what is missing; prints "browsers are already installed"
# otherwise. Run from ui/ so npx resolves the pinned local Playwright.
echo "Ensuring the Playwright chromium build is installed..."
npx playwright install chromium

echo
echo "Worktree ready: UI dependencies and the Playwright browser are in place."
