#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Remote sessions run in a fresh container, so the plugins this repo enables in
# .claude/settings.json are declared but never installed — the session starts
# with "enabled in project settings but isn't installed". This installs them.
# Local machines are left alone; they keep whatever plugin setup they have.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v claude >/dev/null 2>&1; then
  exit 0
fi

marketplace="claude-plugins-official"
plugin="superpowers@${marketplace}"

# Skip when the plugin is already installed AND loading cleanly. A stale or
# broken install still shows up in `plugin list`, so match on its status line
# rather than on the name alone.
listing="$(timeout 60 claude plugin list 2>/dev/null || true)"
if printf '%s\n' "$listing" | grep -A3 -F "$plugin" | grep -qi 'enabled'; then
  exit 0
fi

# The official marketplace ships with the container image, but re-add it if a
# future image drops it.
if ! timeout 60 claude plugin marketplace list 2>/dev/null | grep -qF "$marketplace"; then
  timeout 120 claude plugin marketplace add "anthropics/${marketplace}" >/dev/null
fi

timeout 180 claude plugin install "$plugin" --scope project >/dev/null

echo "Installed ${plugin}; its skills load from the next session in this container."
