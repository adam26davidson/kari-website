#!/usr/bin/env bash
# Telegram transport for the automation fleet: the phone channel that
# carries alerts out and the maintainer's answers back in. GitHub stays
# the source of truth — every reply this script accepts is written onto
# the issue it belongs to before anything else happens, so the decision
# survives the chat scrolling away. Telegram is transport, nothing more.
# See automation/README.md.
#
#   telegram.sh send <text> [--issue N]  # prints the message id; with
#                                        # --issue it remembers that id,
#                                        # so a reply routes to issue N
#   telegram.sh poll                     # consume each new message once
#                                        # and act on it
#
# Polling, not webhooks: the laptop the fleet runs on has no public
# endpoint to receive a callback on. dispatch.sh calls `poll` at the top
# of every tick, before its own pause gate.
#
# Unconfigured is a supported state, not an error: with either secret
# missing (or no jq) the script prints ONE warning line on stderr and
# exits 0, so a fresh clone, CI and the test harnesses never reach the
# network and never fail a tick over a phone.
#
# Env overrides:
#   KARI_TELEGRAM_BOT_TOKEN     required; from @BotFather
#   KARI_TELEGRAM_CHAT_ID       required; the only chat accepted, in
#                               either direction
#   KARI_TELEGRAM_CURL          default curl. One command word — the test
#                               harness points it at a stub script
#   KARI_TELEGRAM_GH_BIN        default gh
#   KARI_TELEGRAM_DISPATCH_BIN  default <repo>/automation/dispatch.sh;
#                               what /status runs (as --status-brief)
#   KARI_AUTOMATION_STATE_DIR   default ~/.local/state/kari-website-automation
#   KARI_AUTOMATION_PAUSE_FILE  default <repo>/automation/PAUSE — the same
#                               file dispatch.sh gates on, so /pause and
#                               `touch automation/PAUSE` are one mechanism
#                               rather than two that can disagree
#   KARI_AUTOMATION_JQ_BIN      default jq. Required here, unlike in
#                               dispatch.sh where it only degrades output
#
# Tests: automation/telegram-test.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${KARI_AUTOMATION_STATE_DIR:-$HOME/.local/state/kari-website-automation}"
PAUSE_FILE="${KARI_AUTOMATION_PAUSE_FILE:-$REPO_ROOT/automation/PAUSE}"
DISPATCH_BIN="${KARI_TELEGRAM_DISPATCH_BIN:-$REPO_ROOT/automation/dispatch.sh}"
CURL="${KARI_TELEGRAM_CURL:-curl}"
GH_BIN="${KARI_TELEGRAM_GH_BIN:-gh}"
JQ_BIN="${KARI_AUTOMATION_JQ_BIN:-jq}"
TOKEN="${KARI_TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${KARI_TELEGRAM_CHAT_ID:-}"

# The config gate comes before argument parsing so that EVERY invocation
# of an unconfigured transport is the same cheap no-op, whatever it was
# asked to do.
if [ -z "$TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo "telegram: KARI_TELEGRAM_BOT_TOKEN/KARI_TELEGRAM_CHAT_ID unset;" \
    "transport disabled (see automation/README.md)" >&2
  exit 0
fi
# jq is not optional here: every response this script reads is JSON, and
# hand-rolling the parse is how a text containing a quote silently routes
# a reply to the wrong issue. Missing jq gets the same treatment as a
# missing token — a warning and a no-op, never a failed tick.
if ! command -v "$JQ_BIN" >/dev/null 2>&1; then
  echo "telegram: jq ($JQ_BIN) not installed; transport disabled" >&2
  exit 0
fi

mkdir -p "$STATE_DIR"
# gh resolves WHICH repo a bare `gh issue comment` targets from the cwd's
# git remote, and the systemd tick runs from $HOME — the first timer-run
# reply died on "not a git repository" while every manual poll, run from
# the repo, worked (#571). Nothing else here is cwd-relative (STATE_DIR
# and PAUSE_FILE are absolute), so pin the cwd once rather than per call.
cd "$REPO_ROOT"
API="https://api.telegram.org/bot$TOKEN"
THREADS="$STATE_DIR/telegram-threads.json"
OFFSET_FILE="$STATE_DIR/telegram-offset"
NUDGE_FILE="$STATE_DIR/nudge"
# Everything this script composes is plain text with emoji and is sent
# WITHOUT a parse_mode, deliberately: the moment a message is Markdown or
# HTML, every dynamic part of it (an issue title, a maintainer's note, a
# path) needs escaping, and the one that slips through does not arrive
# wrongly formatted — it arrives as a 400 and is lost. Emoji need no
# escaping and read the same everywhere.
# Short lines and one item per line, because this is read on a phone.
HELP="🤔 I didn't catch that. I understand:
• a reply to one of my asks
• #<issue> <note> — comment on that issue
• done <issue> — same thing by number
• /pause · /resume · /status"

usage() {
  echo "usage: telegram.sh send <text> [--issue N]"
  echo "       telegram.sh poll"
}

usage_error() { # usage_error <message>
  echo "telegram: $1" >&2
  usage >&2
  exit 2
}

api() { # api <method> [curl args...] — every call is a POST
  local method="$1"
  shift
  "$CURL" -sS --max-time 30 -X POST "$API/$method" "$@"
}

# Telegram rejects a message over 4096 characters outright, and the
# status report grows with the fleet. Clipping here turns "the whole
# message is lost to a 400" into "the message arrives, visibly
# shortened".
MAX_TEXT=3900
clip() { # clip <text>
  if [ "${#1}" -gt "$MAX_TEXT" ]; then
    printf '%s…(truncated)' "${1:0:$MAX_TEXT}"
  else
    printf '%s' "$1"
  fi
}

send_message() { # send_message <text> [reply-to-id] — prints the message id
  local response id args=()
  args=(--data-urlencode "chat_id=$CHAT_ID")
  args+=(--data-urlencode "text=$(clip "$1")")
  if [ -n "${2:-}" ]; then
    args+=(--data-urlencode "reply_to_message_id=$2")
  fi
  if ! response="$(api sendMessage "${args[@]}")"; then
    echo "telegram: sendMessage failed (curl)" >&2
    return 1
  fi
  id="$(printf '%s' "$response" |
    "$JQ_BIN" -r '.result.message_id // empty' 2>/dev/null)" || id=""
  if [ -z "$id" ]; then
    echo "telegram: sendMessage returned no message id: $response" >&2
    return 1
  fi
  printf '%s\n' "$id"
}

# The thread map is message-id string -> issue number, so a bare "looks
# good" typed as a Telegram reply still knows which issue it answers.
# A missing file reads as {}: the first send must not have to seed it.
read_threads() {
  if [ -f "$THREADS" ]; then cat "$THREADS"; else echo '{}'; fi
}

thread_issue() { # thread_issue <message-id> — "" when the id is unknown
  # shellcheck disable=SC2016  # jq program: $id comes from --arg, not bash
  read_threads | "$JQ_BIN" -r --arg id "$1" '.[$id] // empty' 2>/dev/null ||
    true
}

record_thread() { # record_thread <message-id> <issue>
  local tmp
  tmp="$(mktemp "$STATE_DIR/telegram-threads.XXXXXX")"
  # Written to a temp file in the same dir and mv'd over: a poll running
  # from another tick never reads a half-written map.
  # shellcheck disable=SC2016  # jq program: $id/$n come from --arg
  if read_threads |
    "$JQ_BIN" --arg id "$1" --argjson n "$2" '. + {($id): $n}' >"$tmp"
  then
    mv "$tmp" "$THREADS"
  else
    rm -f "$tmp"
    echo "telegram: could not record thread $1 -> issue $2" >&2
  fi
}

cmd_send() { # cmd_send [--issue N] <text> [--issue N]
  local text="" issue="" have_text=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --issue)
        [ "$#" -ge 2 ] || usage_error "--issue needs an issue number"
        issue="$2"
        shift 2
        ;;
      --issue=*)
        issue="${1#--issue=}"
        shift
        ;;
      -*) usage_error "unknown option '$1'" ;;
      *)
        [ "$have_text" = false ] || usage_error "send takes one text argument"
        text="$1"
        have_text=true
        shift
        ;;
    esac
  done
  [ "$have_text" = true ] || usage_error "send needs a text argument"
  if [ -n "$issue" ] && ! [[ "$issue" =~ ^[1-9][0-9]*$ ]]; then
    usage_error "--issue wants a positive issue number, got '$issue'"
  fi
  local id
  id="$(send_message "$text")" || return 1
  [ -z "$issue" ] || record_thread "$id" "$issue"
  printf '%s\n' "$id"
}

comment_on_issue() { # comment_on_issue <issue> <text>
  local issue="$1" text="$2"
  # gh's stderr flows through to the journal on purpose: swallowing it
  # is why #571's "not a git repository" took a reproduction to name.
  if ! "$GH_BIN" issue comment "$issue" \
    --body "From the maintainer via Telegram: $text" >/dev/null
  then
    # The comment IS the record; without it nothing else should happen,
    # least of all clearing the labels that say a human is still needed.
    echo "telegram: gh issue comment $issue failed; reply not recorded" >&2
    send_message "⚠️ could not post your reply to issue #$issue; it is \
not recorded on GitHub — see the tick journal" >/dev/null 2>&1 || true
    return 0
  fi
  # Best effort from here: the labels are housekeeping, and gh exits
  # non-zero for a label that was never on the issue in the first place.
  # A failure here must never read as "your reply was lost".
  if ! "$GH_BIN" issue edit "$issue" --remove-label needs-human \
    --remove-label blocked >/dev/null
  then
    echo "telegram: could not clear needs-human/blocked on #$issue" >&2
  fi
  # An answer from the phone means something just got unblocked; waiting
  # out the rest of a 2h cadence wastes the moment. dispatch.sh consumes
  # this file on its next tick and treats every agent as due.
  touch "$NUDGE_FILE"
  send_message "✅ posted to issue #$issue; fleet nudged" \
    >/dev/null 2>&1 || true
}

handle_message() { # handle_message <text> <reply-to-message-id>
  local text="$1" reply_to="${2:-}" issue="" status_out
  if [ -n "$reply_to" ]; then
    issue="$(thread_issue "$reply_to")"
  fi
  # The prefixes exist because Telegram's reply gesture is easy to miss
  # on a phone, and because an alert can scroll out of easy reach.
  if [ -z "$issue" ]; then
    if [[ "$text" =~ ^#([1-9][0-9]*) ]]; then
      issue="${BASH_REMATCH[1]}"
    elif [[ "$text" =~ ^done[[:space:]]+([1-9][0-9]*) ]]; then
      issue="${BASH_REMATCH[1]}"
    fi
  fi
  if [ -n "$issue" ]; then
    comment_on_issue "$issue" "$text"
    return 0
  fi
  case "$text" in
    /pause*)
      touch "$PAUSE_FILE"
      send_message "⏸️ fleet paused ($PAUSE_FILE) — /resume to start again" \
        >/dev/null 2>&1 || true
      ;;
    /resume*)
      rm -f "$PAUSE_FILE"
      send_message "▶️ fleet resumed — the next tick launches whatever is due" \
        >/dev/null 2>&1 || true
      ;;
    /status*)
      # Diagnostics must not be able to fail the poll, so the dispatcher's
      # own stderr is folded into the reply rather than escaping it.
      status_out="$("$DISPATCH_BIN" --status-brief 2>&1 || true)"
      send_message "${status_out:-(no status output)}" >/dev/null 2>&1 || true
      ;;
    *) send_message "$HELP" >/dev/null 2>&1 || true ;;
  esac
}

field() { # field <update-json> <jq-filter>
  printf '%s' "$1" | "$JQ_BIN" -r "$2" 2>/dev/null || true
}

cmd_poll() {
  local offset=0 response line update count=0 max_id
  if [ -f "$OFFSET_FILE" ]; then
    offset="$(cat "$OFFSET_FILE")"
  fi
  # Re-validated on read rather than trusted: this is state on disk, and
  # a garbage value would go to the API verbatim and 400 every poll from
  # here on. Leading zeros are rejected for the arithmetic below (bash
  # reads them as octal).
  if ! [[ "$offset" =~ ^(0|[1-9][0-9]*)$ ]]; then
    echo "telegram: unusable offset '$offset'; starting from 0" >&2
    offset=0
  fi
  max_id="$offset"
  if ! response="$(api getUpdates --data-urlencode "offset=$offset" \
    --data-urlencode "timeout=0")"
  then
    echo "telegram: getUpdates failed (curl)" >&2
    exit 1
  fi
  if ! printf '%s' "$response" | "$JQ_BIN" -e '.ok == true' >/dev/null 2>&1
  then
    echo "telegram: getUpdates returned no ok result: $response" >&2
    exit 1
  fi
  # One update per line, base64'd: a message text containing a newline or
  # a tab would otherwise shear the parse into two half-updates.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    update="$(printf '%s' "$line" | base64 -d)" || continue
    local update_id chat_id text reply_to
    update_id="$(field "$update" '.update_id // empty')"
    if [[ "$update_id" =~ ^[0-9]+$ ]] && [ "$update_id" -gt "$max_id" ]; then
      max_id="$update_id"
    fi
    count=$((count + 1))
    chat_id="$(field "$update" '.message.chat.id // empty')"
    # No chat: an edited_message, a join event, a poll answer. Nothing
    # here acts on those, and they are consumed rather than re-read.
    [ -n "$chat_id" ] || continue
    if [ "$chat_id" != "$CHAT_ID" ]; then
      echo "telegram: dropping message from foreign chat $chat_id" >&2
      continue
    fi
    text="$(field "$update" '.message.text // empty')"
    # Stickers, photos, voice notes: nothing to route.
    [ -n "$text" ] || continue
    reply_to="$(field "$update" \
      '.message.reply_to_message.message_id // empty')"
    handle_message "$text" "$reply_to" ||
      echo "telegram: failed to handle update $update_id" >&2
  done < <(printf '%s' "$response" | "$JQ_BIN" -r '.result[] | @base64')
  if [ "$count" -gt 0 ]; then
    # Advanced past everything just read, INCLUDING a message whose gh
    # call failed: each message is consumed exactly once, and one message
    # the API keeps rejecting must not wedge every later message behind
    # it. The stderr line above is the record that one was dropped.
    echo "$((max_id + 1))" >"$OFFSET_FILE"
    # A poll with nothing to do says nothing, so the tick journal stays
    # readable; a poll that did work leaves a trace.
    echo "telegram: processed $count update(s)"
  fi
}

case "${1:-}" in
  send)
    shift
    cmd_send "$@"
    ;;
  poll)
    shift
    [ "$#" -eq 0 ] || usage_error "poll takes no arguments"
    cmd_poll
    ;;
  -h | --help)
    usage
    ;;
  *) usage_error "unknown command '${1:-}'" ;;
esac
