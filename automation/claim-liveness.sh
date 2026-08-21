#!/usr/bin/env bash
# Is the worker that claimed agent/<slug> still alive?
#
#   claim-liveness.sh <slug> [issue-number ...]
#
# Prints one "key=value" line per fact the issue-pipeline playbook's
# stale-claim conjunction uses (Phase B), then `alive_by=` and
# `verdict=ALIVE|DEAD`. The verdict is that conjunction verbatim: DEAD
# only when there is no open PR AND neither worktree mtime probe is
# recent AND neither branch tip is recent AND no claimed issue was
# updated inside the window AND no claude-descended process has its cwd
# in the worktree. Everything else it prints — the dispatching tick's
# log and trailer, uncommitted changes — is for the run summary and the
# rescue step; none of it moves the verdict.
#
# The exit status is 0 whenever a verdict was printed (2 = usage error).
# Read `verdict=`, not `$?`: the answer is the output, the way
# dispatch.sh --dry-run's is.
#
# Issue numbers are ARGUMENTS, not discovery. By the time the playbook
# reaches this step it has already grouped `in progress` issues by the
# branch their claim comment names, so it holds the list; asking `gh
# issue list --search` again would be a second, lagging source (search
# index delay, and prefix matches like agent/<slug>-2) that can disagree
# with the grouping the verdict is supposed to cover. With no issue
# arguments that signal is simply silent.
#
# Every probe is read-only, and deliberately so: `git status` without
# --no-optional-locks refreshes the index, which writes into the linked
# worktree's git dir — the next tick would then see fresh mtimes forever
# and a dead claim would never release. For the same reason both -mmin
# probes run before any git command that can write.
#
# A probe that FAILS counts as life (and names itself in `alive_by`), so
# a gh outage or an unreachable remote can never turn into a release.
# The asymmetry the playbook is built on: a false "alive" costs one tick
# of delay; a false "dead" deletes a live worker's worktree.
#
# Env overrides (used by dispatch-test.sh):
#   KARI_AUTOMATION_STATE_DIR   default ~/.local/state/kari-website-automation
#   KARI_AUTOMATION_GH_BIN      default gh
#   KARI_AUTOMATION_CLAUDE_COMM default claude; the /proc comm the
#                               ancestry walk looks for. The harness
#                               needs this: run inside a Claude Code
#                               session, every process it spawns has a
#                               real `claude` ancestor and the negative
#                               test could never fail.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${KARI_AUTOMATION_STATE_DIR:-$HOME/.local/state/kari-website-automation}"
GH_BIN="${KARI_AUTOMATION_GH_BIN:-gh}"
CLAUDE_COMM="${KARI_AUTOMATION_CLAUDE_COMM:-claude}"

# The one place the liveness window is written down. The playbook points
# here instead of restating "2 hours" next to every signal.
WINDOW_MIN=120

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "usage: $(basename "$0") <slug> [issue-number ...]" >&2
  exit 2
fi
shift
ISSUES=("$@")

BRANCH="agent/$SLUG"
WORKTREE_NAME="kari-website-$SLUG"
W="$(dirname "$REPO_ROOT")/$WORKTREE_NAME"
NOW="$(date +%s)"
CUTOFF=$((NOW - WINDOW_MIN * 60))

ALIVE_BY=()
alive() { ALIVE_BY+=("$1"); }

fact() { printf '%s=%s\n' "$1" "$2"; }

# yes when a committer/updated timestamp falls inside the window.
recent() { # recent <epoch>
  [ "$1" -gt "$CUTOFF" ] && echo yes || echo no
}

fact slug "$SLUG"
fact branch "$BRANCH"
fact worktree "$W"
fact window_min "$WINDOW_MIN"

# --- worktree activity (must run before anything that can write) -------
# node_modules/target are pruned: a dependency install months ago is not
# a sign of life, and walking them is the slow part.
worktree_recent=missing
if [ -d "$W" ]; then
  if [ -n "$(find "$W" \( -name node_modules -o -name target \) -prune -o \
    -mmin "-$WINDOW_MIN" -print -quit 2>/dev/null)" ]; then
    worktree_recent=yes
  else
    worktree_recent=no
  fi
fi
fact worktree_recent "$worktree_recent"
[ "$worktree_recent" = yes ] && alive worktree_recent

# A linked worktree's .git is a one-line gitdir file; its index, HEAD and
# refs live under the main clone's .git/worktrees/<name>/, which the find
# above never visits. So index-only staging, or a fetch/merge that moved
# no files, shows up here and nowhere else.
gitdir_recent=missing
if [ -d "$W" ]; then
  gitdir=""
  gitdir="$(git -C "$W" rev-parse --absolute-git-dir 2>/dev/null)" || gitdir=""
  if [ -n "$gitdir" ] && [ -d "$gitdir" ]; then
    if [ -n "$(find "$gitdir" -mmin "-$WINDOW_MIN" -print -quit 2>/dev/null)" ]
    then
      gitdir_recent=yes
    else
      gitdir_recent=no
    fi
  fi
fi
fact gitdir_recent "$gitdir_recent"
[ "$gitdir_recent" = yes ] && alive gitdir_recent

# --- open PR ------------------------------------------------------------
# ANY open PR, labelled or not: Phase A's ownership filter must not hide
# an unlabelled PR from this check. A PR means the claim is not stale at
# all — it belongs to Phase A.
gh_error=no
open_pr=error
if open_pr="$("$GH_BIN" pr list --state open --head "$BRANCH" \
  --json number --jq '.[0].number' 2>/dev/null)"; then
  [ -n "$open_pr" ] || open_pr=none
else
  open_pr=error
fi
fact open_pr "$open_pr"
case "$open_pr" in
  none) ;;
  error) gh_error=yes ;;
  *) alive open_pr ;;
esac

# --- branch tips --------------------------------------------------------
if git -C "$REPO_ROOT" fetch -q origin 2>/dev/null; then
  fact fetch ok
else
  fact fetch failed
  alive fetch-error
fi

tip_facts() { # tip_facts <key> <ref>
  local key="$1" ref="$2" ts
  if ! git -C "$REPO_ROOT" rev-parse --verify -q "$ref" >/dev/null 2>&1; then
    fact "$key" none
    fact "${key}_recent" no
    return
  fi
  ts="$(git -C "$REPO_ROOT" log -1 --format=%ct "$ref" 2>/dev/null)" || ts=""
  if [ -z "$ts" ]; then
    fact "$key" none
    fact "${key}_recent" no
    return
  fi
  fact "$key" "$ts"
  fact "${key}_recent" "$(recent "$ts")"
  [ "$ts" -gt "$CUTOFF" ] && alive "${key}_recent"
  return 0
}
tip_facts local_tip "refs/heads/$BRANCH"
tip_facts remote_tip "refs/remotes/origin/$BRANCH"

# --- claimed issues -----------------------------------------------------
# Any label change, comment or edit counts — including the claim comment
# itself, which is what gives a just-claimed branch its grace period.
if [ "${#ISSUES[@]}" -eq 0 ]; then
  fact issues none
else
  fact issues "$(
    IFS=,
    echo "${ISSUES[*]}"
  )"
  for n in "${ISSUES[@]}"; do
    updated=""
    updated="$("$GH_BIN" issue view "$n" --json updatedAt --jq .updatedAt \
      2>/dev/null)" || updated=""
    if [ -z "$updated" ]; then
      fact "issue_${n}_updated" error
      fact "issue_${n}_recent" no
      gh_error=yes
      continue
    fi
    fact "issue_${n}_updated" "$updated"
    ts=""
    ts="$(date -d "$updated" +%s 2>/dev/null)" || ts=""
    if [ -z "$ts" ]; then
      fact "issue_${n}_recent" no
      gh_error=yes
      continue
    fi
    fact "issue_${n}_recent" "$(recent "$ts")"
    [ "$ts" -gt "$CUTOFF" ] && alive "issue_${n}_recent"
  done
fi
[ "$gh_error" = yes ] && alive gh-error

# --- a claude process working in the worktree right now -----------------
# A worker's tool calls run with their cwd inside the worktree. `no`
# proves nothing on its own — a healthy worker spends most of its wall
# time between tool calls, and each Bash call is a one-shot shell — so
# this only catches a worker that is mid-command at the instant we
# sample. The ancestry requirement separates a live worker from the
# debris a dead one leaves behind: an orphaned dev server reparented to
# PID 1 matches the cwd but has no claude above it.
claude_process=no
for d in /proc/[0-9]*; do
  case "$(readlink "$d/cwd" 2>/dev/null)" in
    */"$WORKTREE_NAME" | */"$WORKTREE_NAME"/*) ;;
    *) continue ;;
  esac
  p="${d#/proc/}"
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    if [ "$(cat "/proc/$p/comm" 2>/dev/null)" = "$CLAUDE_COMM" ]; then
      claude_process=yes
      break 2
    fi
    p="$(awk '/^PPid/{print $2}' "/proc/$p/status" 2>/dev/null)" || p=""
  done
done
fact claude_process "$claude_process"
[ "$claude_process" = yes ] && alive claude_process

# --- corroborating only: never part of the verdict ----------------------
# The rescue step needs to know whether there is uncommitted work to save
# before the worktree is removed. --no-optional-locks so this probe does
# not refresh the index and manufacture a fresh gitdir mtime.
uncommitted=missing
if [ -d "$W" ]; then
  porcelain=""
  porcelain="$(git -C "$W" --no-optional-locks status --porcelain \
    2>/dev/null)" || porcelain=""
  if [ -n "$porcelain" ]; then uncommitted=yes; else uncommitted=no; fi
fi
fact uncommitted "$uncommitted"

# The dispatching tick's log: newest log mentioning the branch. Its
# trailer says how that tick ended — `none` means it was SIGKILLed (OOM)
# or is still running. A usage/spend-limit death shows up as a non-zero
# trailer with the message on the line above.
tick_log=none
tick_log_last=""
tick_log_trailer=none
if [ -d "$STATE_DIR/logs" ]; then
  candidate="$(grep -l -F -- "$BRANCH" "$STATE_DIR/logs"/*.log 2>/dev/null |
    xargs -r ls -1t 2>/dev/null | head -n1)" || candidate=""
  if [ -n "$candidate" ]; then
    tick_log="$candidate"
    tick_log_last="$(tail -n1 "$candidate" 2>/dev/null)" || tick_log_last=""
    if [[ "$tick_log_last" =~ ^tick\ exited\ ([0-9]+)$ ]]; then
      tick_log_trailer="${BASH_REMATCH[1]}"
    fi
  fi
fi
fact tick_log "$tick_log"
fact tick_log_last "$tick_log_last"
fact tick_log_trailer "$tick_log_trailer"

# --- verdict ------------------------------------------------------------
if [ "${#ALIVE_BY[@]}" -eq 0 ]; then
  fact alive_by none
  fact verdict DEAD
else
  fact alive_by "$(
    IFS=,
    echo "${ALIVE_BY[*]}"
  )"
  fact verdict ALIVE
fi
