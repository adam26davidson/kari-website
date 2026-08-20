#!/usr/bin/env bash
# Lint the GitHub Actions workflows under .github/ (issue #313).
#
#   scripts/lint-workflows.sh
#
# Two checks, both of which CI runs through this same script:
#
#   1. actionlint — workflow schema, action inputs, ${{ }} expressions, and
#      a shellcheck pass over each embedded `run:` script.
#   2. Job timeouts — every job must set a positive-integer job-level
#      `timeout-minutes`. Without one a hung step runs toward GitHub's
#      6-hour default (see the comment at the top of ci.yml). Jobs that call
#      a reusable workflow (`uses:` at the job level) are exempt: Actions
#      rejects timeout-minutes on those.
#
# Nothing has to be installed locally: whenever a binary is missing from
# PATH, actionlint runs from the rhysd/actionlint image and the YAML parse
# from mikefarah/yq's. GitHub runners ship yq, so CI pulls only the
# actionlint image.
#
# Tests: scripts/lint-workflows-test.sh
set -uo pipefail

# Pinned so a new actionlint release cannot turn a green PR red on its own;
# bump deliberately (there is no renovate manager for images named here).
ACTIONLINT_IMAGE="${ACTIONLINT_IMAGE:-rhysd/actionlint:1.7.12}"
# Only a YAML→JSON converter, so the floating major tag is fine.
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

if [ "$status" -eq 0 ]; then
  echo "OK: actionlint clean, $checked jobs all set a job-level timeout."
else
  echo "Workflow lint failed — see the findings above." >&2
fi
exit "$status"
