#!/usr/bin/env bash
# Test harness for scripts/lint-workflows.sh. Local-only (not wired into
# CI, which runs the real lint instead); run it whenever the script
# changes:
#   bash scripts/lint-workflows-test.sh
#
# Each case builds a throwaway "repo" holding only .github/workflows and the
# script, then runs the real script against stub `yq`/`docker`/`actionlint`
# on PATH. The stubs log what the script invoked and — for the YAML→JSON
# step — do a real conversion with python3, so the assertions are about the
# script's own logic: which tool it reaches for, and which jobs it flags.
# No image pulls, no network.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINT="$HERE/lint-workflows.sh"
FAILURES=0
WORKDIRS=()

# Invoked by the EXIT trap below.
# shellcheck disable=SC2329
cleanup() {
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

for cmd in python3 jq; do
  command -v "$cmd" > /dev/null || {
    echo "this harness needs $cmd on PATH" >&2
    exit 1
  }
done
python3 -c 'import yaml' 2> /dev/null || {
  echo "this harness needs PyYAML (python3 -c 'import yaml')" >&2
  exit 1
}

# Stubs. `yq` converts the file it is handed; `docker` logs its argv and,
# when it is standing in for yq, converts stdin the same way; `actionlint`
# is a no-op that can be told to fail. STUB_ACTIONLINT_EXIT controls the
# exit code of whichever actionlint the script picked.
STUB_BIN="$(mktemp -d)"
WORKDIRS+=("$STUB_BIN")
cat > "$STUB_BIN/yq" <<'EOF'
#!/usr/bin/env bash
echo "yq $*" >> "$STUB_LOG"
python3 -c 'import json,sys,yaml
json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)' "${@: -1}"
EOF
cat > "$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
case "$*" in
  *mikefarah/yq*)
    python3 -c 'import json,sys,yaml
json.dump(yaml.safe_load(sys.stdin), sys.stdout)'
    ;;
  *actionlint*)
    exit "${STUB_ACTIONLINT_EXIT:-0}"
    ;;
esac
EOF
cat > "$STUB_BIN/actionlint" <<'EOF'
#!/usr/bin/env bash
echo "actionlint $*" >> "$STUB_LOG"
exit "${STUB_ACTIONLINT_EXIT:-0}"
EOF
chmod +x "$STUB_BIN/yq" "$STUB_BIN/docker" "$STUB_BIN/actionlint"

# A stub dir without `yq`, to exercise the docker fallback for the parse,
# and one without a local `actionlint`, which is the normal case.
NO_YQ_BIN="$(mktemp -d)"
WORKDIRS+=("$NO_YQ_BIN")
cp "$STUB_BIN/docker" "$STUB_BIN/actionlint" "$NO_YQ_BIN/"
chmod +x "$NO_YQ_BIN/docker" "$NO_YQ_BIN/actionlint"

# A stub dir whose `jq` fails, for the case below: a check that cannot run
# must fail the lint instead of reporting nothing to fix.
BROKEN_JQ_BIN="$(mktemp -d)"
WORKDIRS+=("$BROKEN_JQ_BIN")
cp "$STUB_BIN/docker" "$STUB_BIN/yq" "$BROKEN_JQ_BIN/"
cat > "$BROKEN_JQ_BIN/jq" <<'EOF'
#!/usr/bin/env bash
echo "jq: stub failure" >&2
exit 3
EOF
chmod +x "$BROKEN_JQ_BIN/docker" "$BROKEN_JQ_BIN/yq" "$BROKEN_JQ_BIN/jq"

NO_ACTIONLINT_BIN="$(mktemp -d)"
WORKDIRS+=("$NO_ACTIONLINT_BIN")
cp "$STUB_BIN/docker" "$STUB_BIN/yq" "$NO_ACTIONLINT_BIN/"
chmod +x "$NO_ACTIONLINT_BIN/docker" "$NO_ACTIONLINT_BIN/yq"

new_repo() {
  local repo
  repo="$(mktemp -d)"
  mkdir -p "$repo/scripts" "$repo/.github/workflows"
  cp "$LINT" "$repo/scripts/lint-workflows.sh"
  chmod +x "$repo/scripts/lint-workflows.sh"
  : > "$repo/stub.log"
  WORKDIRS+=("$repo")
  echo "$repo"
}

run_lint() { # <repo> [args...] — stdout+stderr in <repo>/out
  local repo="$1"
  shift
  STUB_LOG="$repo/stub.log" PATH="${STUB_PATH:-$NO_ACTIONLINT_BIN}:$PATH" \
    bash "$repo/scripts/lint-workflows.sh" "$@" > "$repo/out" 2>&1
  echo $? > "$repo/exit-code"
}

expect_contains() { # <file> <needle> <test-name>
  if grep -qF -- "$2" "$1" 2> /dev/null; then
    echo "ok: $3"
  else
    echo "FAIL: $3 — no '$2' in $1:"
    sed 's/^/    /' "$1" 2> /dev/null || echo "    (missing file)"
    FAILURES=$((FAILURES + 1))
  fi
}

expect_not_contains() { # <file> <needle> <test-name>
  if grep -qF -- "$2" "$1" 2> /dev/null; then
    echo "FAIL: $3 — unexpected '$2' in $1:"
    sed 's/^/    /' "$1" 2> /dev/null
    FAILURES=$((FAILURES + 1))
  else
    echo "ok: $3"
  fi
}

expect_eq() { # <actual> <expected> <test-name>
  if [ "$1" = "$2" ]; then
    echo "ok: $3"
  else
    echo "FAIL: $3 — expected '$2', got '$1'"
    FAILURES=$((FAILURES + 1))
  fi
}

# A workflow whose every job is well-formed, used as the "clean" baseline.
good_workflow() { # <repo> <name>
  cat > "$1/.github/workflows/$2.yml" <<'EOF'
name: Good
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo build
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo test
EOF
}

# 1. Clean repo: both checks run and the script succeeds.
r="$(new_repo)"
good_workflow "$r" ci
run_lint "$r"
expect_eq "$(cat "$r/exit-code")" 0 "clean workflows exit 0"
expect_contains "$r/out" "actionlint" "clean run names the actionlint check"
expect_contains "$r/out" "2 jobs" "clean run reports how many jobs it checked"

# 2. A job with no timeout-minutes is named, with its file, and fails.
r="$(new_repo)"
cat > "$r/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo build
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo deploy
EOF
run_lint "$r"
expect_not_contains "$r/exit-code" "0" "missing timeout-minutes exits non-zero"
expect_contains "$r/out" "deploy" "missing timeout-minutes names the job"
expect_contains "$r/out" ".github/workflows/ci.yml" \
  "missing timeout-minutes names the file"
expect_not_contains "$r/out" "build:" "the job that is fine is not flagged"

# 3. Non-positive and non-integer values are rejected too — a timeout of 0
#    or "10" (a string) would be a workflow-parse failure at runtime.
# The last value is a workflow expression on purpose, not an expansion.
# shellcheck disable=SC2016
for bad in '0' '-5' '"10"' '2.5' '${{ inputs.t }}'; do
  r="$(new_repo)"
  cat > "$r/.github/workflows/ci.yml" <<EOF
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: $bad
    steps:
      - run: echo build
EOF
  run_lint "$r"
  expect_not_contains "$r/exit-code" "0" "timeout-minutes: $bad exits non-zero"
  expect_contains "$r/out" "positive integer" \
    "timeout-minutes: $bad explains the requirement"
done

# 4. A step-level timeout does not satisfy the job-level requirement (the
#    naive grep-for-the-word check would pass this).
r="$(new_repo)"
cat > "$r/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
        timeout-minutes: 3
EOF
run_lint "$r"
expect_not_contains "$r/exit-code" "0" \
  "a step-level timeout does not satisfy the check"
expect_contains "$r/out" "build" "step-level-only timeout names the job"

# 5. Jobs that call a reusable workflow are exempt: Actions rejects
#    timeout-minutes on them, so requiring it would be unsatisfiable.
r="$(new_repo)"
cat > "$r/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push]
jobs:
  call:
    uses: ./.github/workflows/other.yml
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo build
EOF
run_lint "$r"
expect_eq "$(cat "$r/exit-code")" 0 "a reusable-workflow job is exempt"

# 6. Every workflow file is checked, not just the first one.
r="$(new_repo)"
good_workflow "$r" ci
cat > "$r/.github/workflows/deploy.yml" <<'EOF'
name: Deploy
on: [push]
jobs:
  ship:
    runs-on: ubuntu-latest
    steps:
      - run: echo ship
EOF
run_lint "$r"
expect_not_contains "$r/exit-code" "0" "a problem in the second file fails"
expect_contains "$r/out" "deploy.yml" "the second file is named"

# 7. actionlint's own findings fail the script.
r="$(new_repo)"
good_workflow "$r" ci
STUB_ACTIONLINT_EXIT=1 run_lint "$r"
expect_not_contains "$r/exit-code" "0" "actionlint failure fails the script"

# 8. actionlint runs from the pinned docker image when it is not installed,
#    with the repo mounted.
r="$(new_repo)"
good_workflow "$r" ci
run_lint "$r"
expect_contains "$r/stub.log" "rhysd/actionlint:" \
  "actionlint falls back to its pinned docker image"
expect_contains "$r/stub.log" "$r:/repo" "the docker fallback mounts the repo"

# 9. A locally installed actionlint is preferred over the image.
r="$(new_repo)"
good_workflow "$r" ci
STUB_PATH="$STUB_BIN" run_lint "$r"
expect_contains "$r/stub.log" "actionlint " \
  "a local actionlint is used directly"
expect_not_contains "$r/stub.log" "rhysd/actionlint" \
  "a local actionlint skips the docker image"

# 10. Without yq the parse falls back to the yq image, and still flags jobs.
r="$(new_repo)"
cat > "$r/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
EOF
STUB_PATH="$NO_YQ_BIN" run_lint "$r"
expect_contains "$r/stub.log" "mikefarah/yq" \
  "the parse falls back to the yq image"
expect_not_contains "$r/exit-code" "0" "the docker parse still flags a bad job"

# 11. A tree with no workflows is a setup mistake, not a pass.
r="$(new_repo)"
run_lint "$r"
expect_not_contains "$r/exit-code" "0" "no workflow files exits non-zero"
expect_contains "$r/out" "no workflow files" "no workflow files says so"

# 12. A workflow file with no jobs at all would make the timeout check
#     vacuous — fail instead of silently reporting success.
r="$(new_repo)"
cat > "$r/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push]
jobs: {}
EOF
run_lint "$r"
expect_not_contains "$r/exit-code" "0" "a workflow with no jobs exits non-zero"
expect_contains "$r/out" "no jobs" "a workflow with no jobs says so"

# 13. A timeout check that cannot run fails the lint. Without this the
#     check degrades silently: no output reads exactly like nothing to fix.
r="$(new_repo)"
good_workflow "$r" ci
STUB_PATH="$BROKEN_JQ_BIN" run_lint "$r"
expect_not_contains "$r/exit-code" "0" "a broken timeout check exits non-zero"
expect_contains "$r/out" "could not read its jobs" \
  "a broken timeout check says which file it gave up on"

# 14. --help documents usage without running any tool.
r="$(new_repo)"
good_workflow "$r" ci
run_lint "$r" --help
expect_eq "$(cat "$r/exit-code")" 0 "--help exits 0"
expect_contains "$r/out" "usage: scripts/lint-workflows.sh" \
  "--help prints usage"
expect_eq "$(wc -c < "$r/stub.log")" 0 "--help runs no tools"

# 15. Unknown options are rejected rather than silently ignored.
r="$(new_repo)"
good_workflow "$r" ci
run_lint "$r" --wat
expect_contains "$r/out" "unknown option" "unknown option is reported"
expect_not_contains "$r/exit-code" "0" "unknown option exits non-zero"
expect_eq "$(wc -c < "$r/stub.log")" 0 "unknown option runs no tools"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$FAILURES check(s) failed."
fi
exit $((FAILURES > 0))
