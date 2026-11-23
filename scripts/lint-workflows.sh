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
# mikefarah/yq's. That fast path is a convenience, not the definition of
# clean — an installed tool is whatever release the machine has, and the
# difference is not merely missing findings. Shellcheck 0.9 (what GitHub
# runners ship) reports a trap handler as SC2317 where the pinned 0.11
# reports SC2329, so one release reds a tree the other passes.
#
# So `--images` (or KARI_LINT_FORCE_IMAGES=1) skips every `command -v`
# probe and runs the pins below and nothing else. CI passes it, which makes
# the pins the single source of truth for what "clean" means and makes a CI
# finding reproducible on any machine with docker. Reach for it whenever a
# local run disagrees with CI (issue #340).
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

# printf rather than a heredoc + cat: usage has to print on a PATH holding
# nothing but this script's own tools (the test harness runs it on exactly
# that), and printf is a builtin.
usage() {
  printf '%s\n' \
    'usage: scripts/lint-workflows.sh [--images] [--help]' \
    '' \
    '  --images  Run actionlint, shellcheck and the YAML parse from the' \
    '            pinned images above, ignoring any installed binary.' \
    '            This is what CI does, so it is how you reproduce a CI' \
    '            finding locally. Needs docker.' \
    '            Same thing: KARI_LINT_FORCE_IMAGES=1.'
}

# Any value but the empty string and the usual falsy pair turns it on, so
# `KARI_LINT_FORCE_IMAGES=true` does what it looks like it does.
case "${KARI_LINT_FORCE_IMAGES:-}" in
  "" | 0 | false) force_images=0 ;;
  *) force_images=1 ;;
esac

for arg in "$@"; do
  case "$arg" in
    --images)
      force_images=1
      ;;
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

# Every tool with an image fallback is chosen through this, so --images
# cannot half-apply: one probe left in place is one version the pins do not
# describe.
use_local() { # <tool> — true when the run should use the PATH copy
  [ "$force_images" -eq 1 ] && return 1
  command -v "$1" > /dev/null
}

# Checked up front rather than at the first fallback: without docker the
# probes would each answer "use the local binary", which is the answer the
# flag exists to refuse, and the run would look like it honoured it.
if [ "$force_images" -eq 1 ]; then
  command -v docker > /dev/null || {
    echo "--images (KARI_LINT_FORCE_IMAGES) runs every tool from its" \
      "pinned image, and docker is not installed" >&2
    exit 1
  }
  echo "==> --images: actionlint, shellcheck and yq from their pins"
fi

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
if use_local actionlint; then
  actionlint -color || status=1
else
  require docker
  docker run --rm -v "$PWD:/repo:ro" -w /repo "$ACTIONLINT_IMAGE" -color ||
    status=1
fi

# --- 2. job-level timeout-minutes ------------------------------------------
require jq

to_json() { # <workflow file> — the file as JSON on stdout
  if use_local yq; then
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
    def bad_timeout:
      (type) != "number" or floor != . or . <= 0;
    (.jobs // {})
    | to_entries[]
    | select((.value | type) == "object")
    # Reusable-workflow callers cannot set timeout-minutes.
    | select(.value | has("uses") | not)
    | .key as $job
    | .value as $spec
    | ($spec["timeout-minutes"] as $t
      | if $t == null then
          "\($job): no job-level timeout-minutes"
        elif ($t | bad_timeout) then
          "\($job): timeout-minutes must be a positive integer, got"
            + " \($t | tojson)"
        else empty
        end),
      # A composite action cannot bound its own steps, so the step calling
      # a local one is the only place its setup can be (issue #387).
      ($spec.steps // []
      | if type == "array" then to_entries[] else empty end
      | select((.value | type) == "object")
      | select(.value.uses | type == "string" and startswith("./"))
      # Named steps by name, unnamed ones by their 1-based position.
      | (.value.name // .value.id) as $n
      | "\($job): step \(if $n then $n | tojson else .key + 1 end)"
        as $step
      | .value["timeout-minutes"] as $t
      | if $t == null then
          "\($step) uses \(.value.uses) with no step-level"
            + " timeout-minutes — a composite action cannot bound its"
            + " own steps, so the calling step has to"
        elif ($t | bad_timeout) then
          "\($step): timeout-minutes must be a positive integer, got"
            + " \($t | tojson)"
        else empty
        end)
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
  if use_local shellcheck; then
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
#
# Heredoc bodies are skipped: a pin-shaped line there is text a script
# prints (a usage message, a generated file), not an assignment. Only
# heredocs, opened on a line that is not a comment — a pin quoted inside
# an ordinary multi-line string is still flagged; telling those apart needs
# a shell parser, not a line scan. For the same reason a `<<WORD` inside a
# string reads as an opener, and a heredoc still open at the end of the
# file fails the check rather than silently exempting the rest of it.
pin_re='^[[:space:]]*[A-Za-z_]*IMAGE=.*:[A-Za-z0-9]'
# `<<WORD`, `<< 'WORD'`, `<<-"WORD"` — but not the here-string `<<<`.
heredoc_re="(^|[^<])<<(-?)[[:space:]]*[\"']?([A-Za-z_][A-Za-z0-9_]*)"
tab=$'\t'
echo "==> annotated docker-image pins"
for script in "${shell_scripts[@]}"; do
  lineno=0
  previous=""
  terminator=""
  strip_tabs=""
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    if [ -n "$terminator" ]; then
      # `<<-` strips leading tabs from the body, terminator included.
      [ -n "$strip_tabs" ] && line="${line#"${line%%[!"$tab"]*}"}"
      [ "$line" = "$terminator" ] && terminator=""
    else
      if [[ $line =~ $pin_re ]] && [[ $previous != *"# renovate:"* ]]; then
        echo "$script:$lineno: pinned image is invisible to renovate —" \
          "add a '# renovate: datasource=docker' comment directly above" \
          "this line" >&2
        status=1
      fi
      # The comment test goes first: each =~ resets BASH_REMATCH.
      if [[ ! $line =~ ^[[:space:]]*# && $line =~ $heredoc_re ]]; then
        strip_tabs="${BASH_REMATCH[2]}"
        terminator="${BASH_REMATCH[3]}"
      fi
    fi
    previous="$line"
  done < "$script"
  if [ -n "$terminator" ]; then
    echo "$script: the heredoc ended by '$terminator' is never closed, so" \
      "the pin check cannot tell where its body ends" >&2
    status=1
  fi
done

# --- 5. line width ---------------------------------------------------------
# The 80-column convention (AGENTS.md "Code Style Guidelines"), over every
# shell script above and every YAML file under .github. Counted in
# characters, not bytes, so an em dash is one column: in the C locale each
# byte is a character to grep, and a UTF-8 character is one byte outside
# 0x80-0xBF followed by any number inside it — so this pattern counts
# characters the same way on every machine, whatever its locale. There is
# no exemption marker: docs/linting.md says how to wrap each kind of line.
max_width=80
wide_re=$'^([^\x80-\xbf][\x80-\xbf]*){'"$((max_width + 1))"'}'
yaml_files=()
while IFS= read -r file; do
  yaml_files+=("$file")
done < <(find .github \( -name '*.yml' -o -name '*.yaml' \) -print | sort)

width_files=("${shell_scripts[@]}" "${yaml_files[@]}")
echo "==> line width (${#width_files[@]} files, $max_width columns)"
wide_lines="$(LC_ALL=C grep -HnE -- "$wide_re" "${width_files[@]}")"
case $? in
  0)
    while IFS=: read -r file lineno _; do
      echo "$file:$lineno: longer than $max_width characters" >&2
    done <<< "$wide_lines"
    status=1
    ;;
  1) ;; # no wide lines
  *)
    echo "the line-width check could not read its files" >&2
    status=1
    ;;
esac

if [ "$status" -eq 0 ]; then
  echo "OK: actionlint and shellcheck clean, $checked jobs all set a" \
    "job-level timeout, every image pin annotated for renovate, every" \
    "line within $max_width columns."
else
  echo "Lint failed — see the findings above." >&2
fi
exit "$status"
