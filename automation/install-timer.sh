#!/usr/bin/env bash
# Install (or refresh) the systemd user timer that ticks the automation
# fleet. The unit files under automation/systemd/ are the source of truth;
# this script renders them into ~/.config/systemd/user/ and enables the
# timer, so the repo and the laptop cannot drift (issue #296).
#
#   automation/install-timer.sh            # install/refresh, then enable
#   automation/install-timer.sh --dry-run  # report only; write nothing
#
# ExecStart is rendered to the *main clone's* dispatch.sh even when this
# script is run from a linked worktree — a timer pointing at a throwaway
# worktree would stop ticking the day that worktree is removed.
#
# Env overrides (used by install-timer-test.sh):
#   KARI_SYSTEMD_USER_DIR  default $XDG_CONFIG_HOME/systemd/user
#   KARI_SYSTEMCTL_BIN     default systemctl
#
# Tests: automation/install-timer-test.sh
set -uo pipefail

usage() {
  echo "usage: automation/install-timer.sh [--dry-run] [--help]"
}

dry_run=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SRC="$HERE/systemd"
DEFAULT_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_DIR="${KARI_SYSTEMD_USER_DIR:-$DEFAULT_UNIT_DIR}"
SYSTEMCTL="${KARI_SYSTEMCTL_BIN:-systemctl}"

# The main worktree's path — `git worktree list` names it first, whichever
# worktree we are called from. Without git (a tarball copy, say) the
# script's own checkout is the only answer available.
main_clone="$(git -C "$HERE" worktree list --porcelain 2> /dev/null |
  awk '/^worktree /{ print substr($0, 10); exit }')"
[ -n "$main_clone" ] || main_clone="$(dirname "$HERE")"
DISPATCH="$main_clone/automation/dispatch.sh"

if [ ! -x "$DISPATCH" ]; then
  echo "no executable dispatcher at $DISPATCH — refusing to install a" \
    "timer that cannot run" >&2
  exit 1
fi

status=0

install_unit() { # <source file> <installed name>
  local src="$1" dest="$UNIT_DIR/$2" rendered verb
  if [ ! -f "$src" ]; then
    echo "missing unit source: $src" >&2
    status=1
    return
  fi
  rendered="$(cat "$src")" || {
    echo "could not read $src" >&2
    status=1
    return
  }
  rendered="${rendered//\{\{DISPATCH\}\}/$DISPATCH}"

  if [ -f "$dest" ] && [ "$rendered" = "$(cat "$dest")" ]; then
    echo "unchanged: $dest"
    return
  fi
  verb="installed"
  [ -e "$dest" ] && verb="updated"

  if [ "$dry_run" = true ]; then
    echo "would write ($verb): $dest"
    return
  fi
  if ! printf '%s\n' "$rendered" > "$dest"; then
    echo "could not write $dest" >&2
    status=1
    return
  fi
  echo "$verb: $dest"
}

if [ "$dry_run" = true ]; then
  echo "==> dry run: nothing will be written or enabled"
elif ! mkdir -p "$UNIT_DIR"; then
  echo "could not create $UNIT_DIR" >&2
  exit 1
fi

echo "==> units (dispatcher: $DISPATCH)"
install_unit "$UNIT_SRC/kari-automation.service.in" kari-automation.service
install_unit "$UNIT_SRC/kari-automation.timer" kari-automation.timer

[ "$status" -eq 0 ] || {
  echo "Install failed — see the findings above." >&2
  exit "$status"
}

# Both commands are idempotent, so they run even when nothing changed: an
# enabled-but-stopped timer is exactly the state a refresh should repair.
run_systemctl() { # <args...>
  if [ "$dry_run" = true ]; then
    echo "would run: $SYSTEMCTL $*"
    return
  fi
  echo "==> $SYSTEMCTL $*"
  "$SYSTEMCTL" "$@" || status=1
}

run_systemctl --user daemon-reload
run_systemctl --user enable --now kari-automation.timer

if [ "$status" -ne 0 ]; then
  echo "Install failed — see the findings above." >&2
  exit "$status"
fi

if [ "$dry_run" = true ]; then
  echo "Dry run complete — nothing was changed."
else
  echo "Timer installed. Check it with: $SYSTEMCTL --user list-timers" \
    "kari-automation.timer"
  echo "User timers only fire while you have a session; for ticks across" \
    "logouts and reboots run: loginctl enable-linger"
fi
