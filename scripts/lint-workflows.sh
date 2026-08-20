#!/usr/bin/env bash
# Lint the repo's CI surface: the GitHub Actions workflows under .github/
# (issue #313) and the shell scripts CI and developers run (issue #291).
#
#   scripts/lint-workflows.sh
#
# Four checks, all of which CI runs through this same script:
#
#   1. actionlint — workflow schema, action inputs, ${{ }} expressions, and
#      a shellcheck pass over each embedded `run:` script.
#   2. Job timeouts — every job must set a positive-integer job-level
#      `timeout-minutes`. Without one a hung step runs toward GitHub's
#      6-hour default (see the comment at the top of ci.yml). Jobs that call
#      a reusable workflow (`uses:` at the job level) are exempt: Actions
#      rejects timeout-minutes on those.
#   3. shellcheck over every *.sh in the repo (scripts/, automation/, the
#      CodeDeploy hooks). actionlint only sees the shell embedded in
#      workflows; these are the scripts that shell calls out to. Findings
#      are not filtered by severity: shellcheck's `info` tier is where
#      SC2086 and friends live, so a `--severity` floor would buy quiet
#      with real bugs. A false positive gets a `# shellcheck disable=` at
#      its own line instead.
#   4. Annotated image pins — every pinned docker image in those scripts
#      needs a `# renovate: datasource=docker` comment above it, which is
#      what renovate.json's customManager keys off. Without one the pin is
#      invisible to renovate and rots silently (issue #327).
#
# Nothing has to be installed locally: whenever a binary is missing from
# PATH, actionlint/shellcheck run from their images and the YAML parse from
# mikefarah/yq's. GitHub runners ship yq and shellcheck, so CI pulls only
# the actionlint image — which does mean CI's shellcheck is the runner's
# version rather than the pin below. That skew cuts both ways: the runner's
# older release can miss a finding the pin makes, and it can also raise one
# the pin does not (it has: SC2317 on a trap handler that 0.11 reports as
# SC2329 instead). So a locally clean run is not proof CI is clean, and a
# disable comment for a version-skew false positive has to name every code
# the releases in play emit. Issue #340 tracks making CI use the pins so
# the two agree.
#
# Tests: scripts/lint-workflows-test.sh
set -uo pipefail

# Pinned so a new release cannot turn a green PR red on its own. The
# annotations are how renovate finds these (customManagers in
# renovate.json) — check 4 below fails the lint if a pin loses one.
# renovate: datasource=docker
ACTIONLINT_IMAGE="${ACTIONLINT_IMAGE:-rhysd/actionlint:1.7.12}"
# renovate: datasource=docker
SHELLCHECK_IMAGE="${SHELLCHECK_IMAGE:-koalaman/shellcheck:v0.11.0}"
# Only a YAML→JSON converter, so the floating major tag is fine.
# renovate: datasource=docker
YQ_IMAGE="${YQ_IMAGE:-mikefarah/yq:4}"

usage() { echo "usage: scripts/lint-workflows.sh [--help]"; }

for arg in "$@"; do
  case "$arg" in
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

# No `set -e` here: the checks below run to completion and report every
# finding, so each failure is handled explicitly.
cd "$(dirname "$0")/.." || exit 1

require() {
  command -v "$1" > /dev/null || {
    echo "$1 is required but not installed" >&2
    exit 1
  }
}

shopt -s nullglob
workflows=(.github/workflows/*.yml .github/workflows/*.yaml)
if [ ${#workflows[@]} -eq 0 ]; then
  echo "no workflow files in .github/workflows" >&2
  exit 1
fi

status=0

# --- 1. actionlint ---------------------------------------------------------
# With no file arguments actionlint discovers every workflow in the repo,
# which is what we want: the composite action under .github/actions is
# checked through the workflows that use it.
echo "==> actionlint (${#workflows[@]} workflow files)"
if command -v actionlint > /dev/null; then
  actionlint -color || status=1
else
  require docker
  docker run --rm -v "$PWD:/repo:ro" -w /repo "$ACTIONLINT_IMAGE" -color ||
    status=1
fi

# --- 2. job-level timeout-minutes ------------------------------------------
require jq

to_json() { # <workflow file> — the file as JSON on stdout
  if command -v yq > /dev/null; then
    yq -o=json '.' "$1"
  else
    require docker
    docker run --rm -i "$YQ_IMAGE" -o=json '.' - < "$1"
  fi
}

echo "==> job timeout-minutes"
checked=0
for wf in "${workflows[@]}"; do
  json="$(to_json "$wf")" || {
    echo "$wf: could not be parsed as YAML — if yq is installed, this" \
      "check needs mikefarah/yq v4" >&2
    status=1
    continue
  }

  if ! count="$(jq -r '(.jobs // {}) | length' <<< "$json")"; then
    echo "$wf: the timeout check could not read its jobs" >&2
    status=1
    continue
  fi
  if [ "$count" -eq 0 ]; then
    echo "$wf: no jobs found — a workflow without jobs is a mistake, and it" \
      "would make this check vacuous" >&2
    status=1
    continue
  fi
  checked=$((checked + count))

  # A jq failure has to fail the lint: an unreadable file must never look
  # like a file with nothing to report.
  if ! problems="$(jq -r '
    (.jobs // {})
    | to_entries[]
    | select((.value | type) == "object")
    # Reusable-workflow callers cannot set timeout-minutes.
    | select(.value | has("uses") | not)
    | .key as $job
    | .value["timeout-minutes"] as $t
    | if $t == null then
        "\($job): no job-level timeout-minutes"
      elif ($t | type) != "number" or ($t | floor) != $t or $t <= 0 then
        "\($job): timeout-minutes must be a positive integer, got"
          + " \($t | tojson)"
      else empty
      end
  ' <<< "$json")"; then
    echo "$wf: the timeout check could not read its jobs" >&2
    status=1
    continue
  fi

  if [ -n "$problems" ]; then
    while IFS= read -r problem; do
      echo "$wf: $problem" >&2
    done <<< "$problems"
    status=1
  fi
done

# --- 3. shellcheck over the repo's own shell scripts -----------------------
# Dependency and build trees are excluded: they are not ours to fix, and
# their vendored scripts would bury the findings that are. So is .claude,
# where the harness parks whole worktrees of this repo.
shell_scripts=()
while IFS= read -r script; do
  shell_scripts+=("$script")
done < <(
  find . \
    \( -name .git -o -name .claude -o -name node_modules -o -name target \
    -o -name dist -o -name coverage -o -name playwright-report \) -prune -o \
    -name '*.sh' -print | sort
)

echo "==> shellcheck (${#shell_scripts[@]} shell scripts)"
if [ ${#shell_scripts[@]} -eq 0 ]; then
  # Unreachable while this file exists, so it means the search itself broke
  # — and a check that silently examines nothing reads exactly like a pass.
  echo "no shell scripts found — the shellcheck pass would be vacuous" >&2
  status=1
else
  # -x follows sourced files, so the CodeDeploy hooks' `. env.sh` resolves
  # instead of being reported as an unfollowable source.
  if command -v shellcheck > /dev/null; then
    shellcheck -x "${shell_scripts[@]}" || status=1
  else
    require docker
    docker run --rm -v "$PWD:/repo:ro" -w /repo "$SHELLCHECK_IMAGE" \
      -x "${shell_scripts[@]}" || status=1
  fi
fi

# --- 4. annotated docker-image pins ----------------------------------------
# A pin is any `*IMAGE=` assignment carrying a literal `:tag`; that skips
# assignments from arguments or other variables, which have nothing to
# track. Renovate reads the comment on the line above, so that is where the
# annotation has to be.
echo "==> annotated docker-image pins"
for script in "${shell_scripts[@]}"; do
  while IFS=: read -r lineno _; do
    [ -n "$lineno" ] || continue
    previous=""
    [ "$lineno" -gt 1 ] && previous="$(sed -n "$((lineno - 1))p" "$script")"
    case "$previous" in
      *"# renovate:"*) ;;
      *)
        echo "$script:$lineno: pinned image is invisible to renovate —" \
          "add a '# renovate: datasource=docker' comment directly above" \
          "this line" >&2
        status=1
        ;;
    esac
  done < <(grep -n '^[[:space:]]*[A-Za-z_]*IMAGE=.*:[A-Za-z0-9]' "$script")
done

if [ "$status" -eq 0 ]; then
  echo "OK: actionlint and shellcheck clean, $checked jobs all set a" \
    "job-level timeout, every image pin annotated for renovate."
else
  echo "Lint failed — see the findings above." >&2
fi
exit "$status"
