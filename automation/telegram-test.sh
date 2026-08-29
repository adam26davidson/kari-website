#!/usr/bin/env bash
# Test harness for automation/telegram.sh. Runs in CI (the shell-lint
# job) and locally; run it whenever telegram.sh changes:
#   bash automation/telegram-test.sh
#
# Hermetic by construction: every run points KARI_TELEGRAM_CURL at a
# recording stub that replays canned JSON, KARI_TELEGRAM_GH_BIN at a
# recording gh stub, KARI_TELEGRAM_DISPATCH_BIN at a stub recording its
# flags and printing canned status, and the state/pause paths into a
# temp dir. So the harness can
# never reach api.telegram.org, comment on a real issue, pause the live
# fleet, or read the fleet's real state — here or on the maintainer's
# laptop, where the transport is configured for real.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TELEGRAM="$HERE/telegram.sh"
FAILURES=0
WORKDIRS=()

cleanup() {
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

# Every test gets its own workdir, its own stubs and its own logs, so no
# assertion can be satisfied by a leftover from the test before it.
new_work() {
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/state" "$work/responses"
  : >"$work/curl-log"
  : >"$work/gh-log"
  : >"$work/dispatch-log"
  # The API stub: the full argv on one line, then whichever canned
  # response the test wrote for the method being called. It matches on
  # the URL rather than an argument position, so reordering telegram.sh's
  # --data-urlencode flags does not silently turn this into a no-op.
  cat >"$work/curl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$CURL_LOG"
for arg in "$@"; do
  case "$arg" in
    */sendMessage)
      cat "$RESPONSE_DIR/sendMessage.json"
      exit 0
      ;;
    */getUpdates)
      cat "$RESPONSE_DIR/getUpdates.json"
      exit 0
      ;;
  esac
done
echo '{"ok":false,"description":"stub: unknown method"}'
EOF
  chmod +x "$work/curl"
  cat >"$work/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
# The cwd goes to its own log: a bare `gh issue comment` resolves WHICH
# repo from the cwd's git remote, so where gh runs is behavior (#571).
pwd >>"$GH_CWD_LOG"
EOF
  chmod +x "$work/gh"
  : >"$work/gh-cwd-log"
  # Records the flags it was called with as well as answering: /status
  # must ask for the phone-formatted report (--status-brief), not the
  # 80-column one, and only the argv can prove which.
  cat >"$work/dispatch" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$DISPATCH_LOG"
echo "canned status: issue-pipeline every=4h"
EOF
  chmod +x "$work/dispatch"
  # Defaults a test can overwrite; without them the stub would cat a
  # missing file and the failure would read as a telegram.sh bug.
  echo '{"ok":true,"result":{"message_id":100}}' \
    >"$work/responses/sendMessage.json"
  echo '{"ok":true,"result":[]}' >"$work/responses/getUpdates.json"
  WORKDIRS+=("$work")
  echo "$work"
}

# TOKEN/CHAT_ID are overridable per call (TOKEN= exercises the
# unconfigured no-op). CURL_LOG, RESPONSE_DIR, GH_LOG and DISPATCH_LOG
# ride along in the environment: telegram.sh execs the stubs directly, so the prefix's
# environment is what they see.
run_telegram() { # <workdir> [args...] — stdout in <workdir>/out, stderr in err
  local work="$1"
  shift
  CURL_LOG="$work/curl-log" \
  RESPONSE_DIR="$work/responses" \
  GH_LOG="$work/gh-log" \
  GH_CWD_LOG="$work/gh-cwd-log" \
  DISPATCH_LOG="$work/dispatch-log" \
  KARI_TELEGRAM_BOT_TOKEN="${TOKEN-test-token}" \
  KARI_TELEGRAM_CHAT_ID="${CHAT_ID-4242}" \
  KARI_TELEGRAM_CURL="$work/curl" \
  KARI_TELEGRAM_GH_BIN="$work/gh" \
  KARI_TELEGRAM_DISPATCH_BIN="$work/dispatch" \
  KARI_AUTOMATION_STATE_DIR="$work/state" \
  KARI_AUTOMATION_PAUSE_FILE="$work/PAUSE" \
    bash "$TELEGRAM" "$@" >"$work/out" 2>"$work/err"
  echo $? >"$work/exit-code"
}

expect_eq() { # <actual> <expected> <test-name>
  if [ "$1" = "$2" ]; then
    echo "ok: $3"
  else
    echo "FAIL: $3 — expected '$2', got '$1'"
    FAILURES=$((FAILURES + 1))
  fi
}

expect_contains() { # <file> <needle> <test-name>
  if grep -qF -- "$2" "$1" 2>/dev/null; then
    echo "ok: $3"
  else
    echo "FAIL: $3 — no '$2' in $1:"
    sed 's/^/    /' "$1" 2>/dev/null || echo "    (missing file)"
    FAILURES=$((FAILURES + 1))
  fi
}

# A missing file is a failure, not an absence: otherwise every
# expect_not_contains passes for free on a run that wrote nothing.
expect_not_contains() { # <file> <needle> <test-name>
  if [ ! -e "$1" ]; then
    echo "FAIL: $3 — expected file $1 (cannot assert '$2' is absent)"
    FAILURES=$((FAILURES + 1))
  elif grep -qF -- "$2" "$1" 2>/dev/null; then
    echo "FAIL: $3 — unexpected '$2' in $1"
    FAILURES=$((FAILURES + 1))
  else
    echo "ok: $3"
  fi
}

expect_file() { # <path> <test-name>
  if [ -e "$1" ]; then
    echo "ok: $2"
  else
    echo "FAIL: $2 — expected file $1"
    FAILURES=$((FAILURES + 1))
  fi
}

expect_file_absent() { # <path> <test-name>
  if [ -e "$1" ]; then
    echo "FAIL: $2 — unexpected file $1"
    FAILURES=$((FAILURES + 1))
  else
    echo "ok: $2"
  fi
}

# The last getUpdates call the stub recorded — what an offset assertion
# has to read, since the log also holds the sendMessage calls.
last_poll() { # <workdir> — writes <workdir>/last-poll and echoes the path
  grep -F getUpdates "$1/curl-log" | tail -1 >"$1/last-poll"
  echo "$1/last-poll"
}

update_json() { # <workdir> <json array body> — the canned getUpdates reply
  printf '{"ok":true,"result":[%s]}\n' "$2" >"$1/responses/getUpdates.json"
}

# 1. No token (or no chat id) is a supported state, not an error: a fresh
#    clone, CI and the other harnesses all run without one, and none of
#    them may reach the network or fail a tick over a missing phone.
w="$(new_work)"
TOKEN='' run_telegram "$w" send "hello"
expect_eq "$(cat "$w/exit-code")" 0 "unset token exits 0"
expect_eq "$(wc -l <"$w/err")" 1 "unset token prints exactly one warning"
expect_contains "$w/err" "KARI_TELEGRAM_BOT_TOKEN" \
  "the warning names the variables to set"
expect_eq "$(wc -c <"$w/curl-log")" 0 "unset token never touches the API"

w="$(new_work)"
CHAT_ID='' run_telegram "$w" poll
expect_eq "$(cat "$w/exit-code")" 0 "unset chat id exits 0"
expect_eq "$(wc -c <"$w/curl-log")" 0 "unset chat id never touches the API"

# 2. send prints the message id the API returned, and --issue remembers
#    it so a reply to that message can be routed back to the issue.
w="$(new_work)"
echo '{"ok":true,"result":{"message_id":77}}' >"$w/responses/sendMessage.json"
run_telegram "$w" send "needs a human" --issue 5
expect_eq "$(cat "$w/exit-code")" 0 "send exits 0"
expect_eq "$(cat "$w/out")" 77 "send prints the message id"
expect_contains "$w/curl-log" "sendMessage" "send POSTs sendMessage"
expect_contains "$w/curl-log" "text=needs a human" "send passes the text"
expect_contains "$w/curl-log" "chat_id=4242" "send targets the configured chat"
expect_eq "$(jq -r '."77"' "$w/state/telegram-threads.json")" 5 \
  "send --issue records message id -> issue"

# 3. Without --issue there is no thread to record; an empty map would
#    only be noise for the poll to read.
w="$(new_work)"
run_telegram "$w" send "just a note"
expect_eq "$(cat "$w/out")" 100 "send without --issue still prints the id"
expect_file_absent "$w/state/telegram-threads.json" \
  "send without --issue records no thread"

# 4. A bad --issue is a usage error, not a thread recorded under a
#    nonsense key.
w="$(new_work)"
run_telegram "$w" send "note" --issue abc
expect_eq "$(cat "$w/exit-code")" 2 "a non-numeric --issue exits 2"
w="$(new_work)"
run_telegram "$w" send
expect_eq "$(cat "$w/exit-code")" 2 "send with no text exits 2"
w="$(new_work)"
run_telegram "$w" frobnicate
expect_eq "$(cat "$w/exit-code")" 2 "an unknown command exits 2"

# 5. The round trip: an alert sent with --issue 5, then a Telegram reply
#    to that message. The reply becomes a comment on issue 5, the labels
#    that say a human is still needed come off, and the fleet is nudged
#    so the answer is acted on within a tick rather than a cadence.
w="$(new_work)"
echo '{"ok":true,"result":{"message_id":77}}' >"$w/responses/sendMessage.json"
run_telegram "$w" send "needs a human" --issue 5
update_json "$w" '{"update_id":10,"message":{"message_id":200,
  "chat":{"id":4242},"text":"looks good, ship it",
  "reply_to_message":{"message_id":77}}}'
run_telegram "$w" poll
expect_eq "$(cat "$w/exit-code")" 0 "poll exits 0"
expect_contains "$w/gh-log" "issue comment 5" "a reply comments on its issue"
expect_contains "$w/gh-log" \
  "From the maintainer via Telegram: looks good, ship it" \
  "the comment is prefixed and carries the text"
expect_contains "$w/gh-log" "--remove-label needs-human" \
  "the reply clears needs-human"
expect_contains "$w/gh-log" "--remove-label blocked" \
  "the reply clears blocked"
expect_file "$w/state/nudge" "a reply nudges the fleet"
expect_contains "$w/curl-log" "posted to issue #5" \
  "the maintainer is told the reply landed"
expect_eq "$(cat "$w/state/telegram-offset")" 11 \
  "the offset advances past the update just consumed"
expect_contains "$w/out" "processed 1 update(s)" "poll reports what it did"

# 6. The persisted offset is what the next poll asks from, so no message
#    is ever handled twice.
update_json "$w" ''
run_telegram "$w" poll
expect_contains "$(last_poll "$w")" "offset=11" \
  "the next poll asks from the persisted offset"
expect_eq "$(cat "$w/out")" "" "a poll with no updates says nothing"

# 7. The reply gesture is easy to miss on a phone, so a "#N ..." or
#    "done N" prefix routes without one.
w="$(new_work)"
update_json "$w" '{"update_id":3,"message":{"message_id":201,
  "chat":{"id":4242},"text":"#7 looks good"}}'
run_telegram "$w" poll
expect_contains "$w/gh-log" "issue comment 7" "#7 routes to issue 7"

w="$(new_work)"
update_json "$w" '{"update_id":4,"message":{"message_id":202,
  "chat":{"id":4242},"text":"done 9"}}'
run_telegram "$w" poll
expect_contains "$w/gh-log" "issue comment 9" "'done 9' routes to issue 9"

# 8. Anyone who finds the bot can message it. Only the configured chat is
#    ever acted on — and the update is still consumed, so a stranger
#    cannot wedge the queue by messaging repeatedly.
w="$(new_work)"
update_json "$w" '{"update_id":5,"message":{"message_id":203,
  "chat":{"id":999},"text":"#7 ship it"}}'
run_telegram "$w" poll
expect_eq "$(cat "$w/exit-code")" 0 "a foreign message does not fail the poll"
expect_eq "$(wc -c <"$w/gh-log")" 0 "a foreign chat reaches no gh command"
expect_contains "$w/err" "foreign chat 999" "the foreign chat is logged"
expect_eq "$(cat "$w/state/telegram-offset")" 6 \
  "a foreign message is still consumed"

# 9. The commands. /pause and /resume drive the same PAUSE file
#    dispatch.sh gates on, so the phone and `touch automation/PAUSE` are
#    one mechanism rather than two that can disagree.
w="$(new_work)"
update_json "$w" '{"update_id":6,"message":{"message_id":204,
  "chat":{"id":4242},"text":"/pause"}}'
run_telegram "$w" poll
expect_file "$w/PAUSE" "/pause creates the pause file"
expect_contains "$w/curl-log" "fleet paused" "...and says so"

update_json "$w" '{"update_id":7,"message":{"message_id":205,
  "chat":{"id":4242},"text":"/resume"}}'
run_telegram "$w" poll
expect_file_absent "$w/PAUSE" "/resume removes the pause file"
expect_contains "$w/curl-log" "fleet resumed" "...and says so"

w="$(new_work)"
update_json "$w" '{"update_id":8,"message":{"message_id":206,
  "chat":{"id":4242},"text":"/status"}}'
run_telegram "$w" poll
expect_contains "$w/curl-log" "canned status: issue-pipeline" \
  "/status replies with the dispatcher's own output"
expect_contains "$w/dispatch-log" "--status-brief" \
  "/status asks for the phone-formatted report, not the 80-column one"

# 10. Anything else gets the help rather than silence: a typo that
#     vanishes looks exactly like a fleet that has stopped. The help is a
#     short bullet list, one item per line, because it is read on a phone.
w="$(new_work)"
update_json "$w" '{"update_id":9,"message":{"message_id":207,
  "chat":{"id":4242},"text":"hello?"}}'
run_telegram "$w" poll
expect_contains "$w/curl-log" "/pause" "unrouted text gets the help reply"
expect_contains "$w/curl-log" "• done <issue>" \
  "the help lists one thing it understands per line"
expect_eq "$(wc -c <"$w/gh-log")" 0 "unrouted text comments on no issue"

# 11. A multi-line answer is the normal case for "explain what you did",
#     and it must survive the update parse in one piece — hence the
#     base64 iteration rather than a line-oriented read.
w="$(new_work)"
update_json "$w" '{"update_id":12,"message":{"message_id":208,
  "chat":{"id":4242},"text":"#7 ran the migration\nsecond line here"}}'
run_telegram "$w" poll
expect_eq "$(grep -cF 'issue comment 7' "$w/gh-log")" 1 \
  "a multi-line reply produces exactly one comment"
expect_contains "$w/gh-log" "ran the migration" "the first line survives"
expect_contains "$w/gh-log" "second line here" "the second line survives"

# 12. Updates with nothing to route (an edited message, a sticker) are
#     consumed quietly rather than answered with help.
w="$(new_work)"
update_json "$w" '{"update_id":20,"edited_message":{"message_id":209,
  "chat":{"id":4242},"text":"typo fixed"}},
  {"update_id":21,"message":{"message_id":210,"chat":{"id":4242},
  "sticker":{"emoji":"👍"}}}'
run_telegram "$w" poll
expect_eq "$(wc -c <"$w/gh-log")" 0 "a non-message update reaches no gh"
expect_not_contains "$w/curl-log" "sendMessage" \
  "a non-message update draws no reply"
expect_eq "$(cat "$w/state/telegram-offset")" 22 \
  "non-message updates are still consumed"

# 13. A failed gh comment must not look like success: the labels stay on,
#     nothing is nudged, and the maintainer is told. The offset still
#     advances — one unpostable message may not wedge every later one.
w="$(new_work)"
cat >"$w/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
exit 1
EOF
chmod +x "$w/gh"
update_json "$w" '{"update_id":30,"message":{"message_id":211,
  "chat":{"id":4242},"text":"#7 ship it"}}'
run_telegram "$w" poll
expect_eq "$(cat "$w/exit-code")" 0 "a failed gh comment does not fail the poll"
expect_not_contains "$w/gh-log" "--remove-label" \
  "a failed comment leaves the labels alone"
expect_file_absent "$w/state/nudge" "a failed comment nudges nothing"
expect_contains "$w/err" "reply not recorded" "the failure is logged"
expect_contains "$w/curl-log" "could not post your reply to issue #7" \
  "...and the maintainer is told, rather than left assuming it landed"
expect_eq "$(cat "$w/state/telegram-offset")" 31 \
  "an unpostable message is still consumed"

# 14. An API that is unreachable or unhappy is reported, not silently
#     treated as an empty inbox — and the offset is left where it was so
#     nothing is skipped.
w="$(new_work)"
echo '{"ok":false,"description":"Unauthorized"}' \
  >"$w/responses/getUpdates.json"
run_telegram "$w" poll
expect_eq "$(cat "$w/exit-code")" 1 "a non-ok getUpdates exits 1"
expect_contains "$w/err" "getUpdates" "the failure names the call"
expect_file_absent "$w/state/telegram-offset" \
  "a failed poll does not move the offset"

# 15. A garbage offset on disk would go to the API verbatim and 400 every
#     poll from here on, so it is re-validated on read.
w="$(new_work)"
echo "not-a-number" >"$w/state/telegram-offset"
update_json "$w" '{"update_id":40,"message":{"message_id":212,
  "chat":{"id":4242},"text":"#7 ok"}}'
run_telegram "$w" poll
expect_contains "$(last_poll "$w")" "offset=0" \
  "an unusable offset restarts from 0 instead of poisoning every poll"
expect_eq "$(cat "$w/state/telegram-offset")" 41 "...and is then repaired"

# 16. gh runs from the repo, wherever the caller stood. The systemd tick
#     runs from $HOME, and a bare `gh issue comment` resolves which repo
#     to target from the cwd's git remote — the first timer-consumed
#     reply died on "not a git repository" while every manual poll, run
#     from the repo, had worked (#571). The workdir is under /tmp and is
#     no git repository, which is exactly the failing shape.
w="$(new_work)"
update_json "$w" '{"update_id":40,"message":{"message_id":300,
  "chat":{"id":4242},"text":"#7 works from anywhere"}}'
( cd "$w" && run_telegram "$w" poll )
expect_contains "$w/gh-log" "issue comment 7" \
  "a reply polled from a foreign cwd still reaches gh"
expect_eq "$(sort -u "$w/gh-cwd-log")" "$(cd "$HERE/.." && pwd)" \
  "every gh call runs from the repo root, not the caller's cwd"

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) FAILED"
  exit 1
fi
echo "all tests passed"
