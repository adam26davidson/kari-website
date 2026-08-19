#!/usr/bin/env bash
# Fleet dispatcher: the only thing cron calls. Reads agent definitions
# (YAML frontmatter + prompt body) from automation/agents/, launches each
# enabled agent whose interval has elapsed as a headless Claude session
# from the repo root, and records last-run/locks/logs in a laptop-local
# state dir. See automation/README.md.
#
#   dispatch.sh [--dry-run]     # --dry-run: report decisions, launch nothing
#
# Env overrides (used by dispatch-test.sh):
#   KARI_AUTOMATION_STATE_DIR   default ~/.local/state/kari-website-automation
#   KARI_AUTOMATION_AGENTS_DIR  default <repo>/automation/agents
#   KARI_AUTOMATION_PAUSE_FILE  default <repo>/automation/PAUSE
#   KARI_AUTOMATION_CLAUDE_BIN  default claude
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_DIR="${KARI_AUTOMATION_AGENTS_DIR:-$REPO_ROOT/automation/agents}"
STATE_DIR="${KARI_AUTOMATION_STATE_DIR:-$HOME/.local/state/kari-website-automation}"
PAUSE_FILE="${KARI_AUTOMATION_PAUSE_FILE:-$REPO_ROOT/automation/PAUSE}"
CLAUDE_BIN="${KARI_AUTOMATION_CLAUDE_BIN:-claude}"

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

if [ -e "$PAUSE_FILE" ]; then
  echo "fleet paused ($PAUSE_FILE exists) — remove it to resume"
  exit 0
fi

mkdir -p "$STATE_DIR/logs"

# First "key: value" between the first two --- lines of an agent file.
frontmatter() { # frontmatter <file> <key>
  awk -v key="$2" '
    /^---[[:space:]]*$/ { n++; next }
    n == 1 && $1 == key":" {
      sub(/^[^:]*:[[:space:]]*/, "")
      sub(/[[:space:]]*(#.*)?$/, "")
      print
      exit
    }
    n >= 2 { exit }
  ' "$1"
}

# Everything after the second --- line: the agent's prompt.
prompt_body() { # prompt_body <file>
  awk '/^---[[:space:]]*$/ && n < 2 { n++; next } n >= 2 { print }' "$1"
}

interval_seconds() { # interval_seconds <Nm|Nh|Nd>
  case "$1" in
    *m) echo $((${1%m} * 60)) ;;
    *h) echo $((${1%h} * 3600)) ;;
    *d) echo $((${1%d} * 86400)) ;;
    *)
      echo "unparseable interval '$1' (want Nm/Nh/Nd)" >&2
      return 1
      ;;
  esac
}

launch() { # launch <name> <model> <fallback> <agent-file> — backgrounded
  local name="$1" model="$2" fallback="$3" agent_file="$4"
  local log
  log="$STATE_DIR/logs/$name-$(date +%Y%m%dT%H%M%S).log"
  (
    flock -n 9 || {
      echo "skip $name: previous run still holds the lock"
      exit 0
    }
    date +%s >"$STATE_DIR/$name.last-run"
    echo "run $name -> $log"
    cd "$REPO_ROOT"
    # Unquoted ${var:+...} is deliberate: no flag at all when unset.
    # shellcheck disable=SC2086
    prompt_body "$agent_file" |
      "$CLAUDE_BIN" -p --dangerously-skip-permissions \
        ${model:+--model "$model"} \
        ${fallback:+--fallback-model "$fallback"} >"$log" 2>&1
  ) 9>"$STATE_DIR/$name.lock" &
  disown
}

for agent_file in "$AGENTS_DIR"/*.md; do
  [ -e "$agent_file" ] || continue
  name="$(frontmatter "$agent_file" name)"
  enabled="$(frontmatter "$agent_file" enabled)"
  every="$(frontmatter "$agent_file" every)"
  model="$(frontmatter "$agent_file" model)"
  fallback="$(frontmatter "$agent_file" fallback)"

  if [ -z "$name" ] || [ -z "$every" ]; then
    echo "SKIP $(basename "$agent_file"): missing name/every frontmatter" >&2
    continue
  fi
  if [ "$enabled" != "true" ]; then
    echo "skip $name: disabled"
    continue
  fi
  if ! secs="$(interval_seconds "$every")"; then
    echo "SKIP $name: bad interval" >&2
    continue
  fi

  now="$(date +%s)"
  last=0
  [ -f "$STATE_DIR/$name.last-run" ] && last="$(cat "$STATE_DIR/$name.last-run")"
  if [ $((now - last)) -lt "$secs" ]; then
    echo "skip $name: not due ($((secs - (now - last)))s remaining)"
    continue
  fi

  if $DRY_RUN; then
    echo "WOULD RUN $name (model=${model:-default}, every=$every)"
    continue
  fi
  launch "$name" "$model" "$fallback" "$agent_file"
done

find "$STATE_DIR/logs" -type f -mtime +30 -delete 2>/dev/null || true
