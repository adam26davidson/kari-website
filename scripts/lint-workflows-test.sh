#!/usr/bin/env bash
# Test harness for scripts/lint-workflows.sh. CI runs it in the shell-lint
# job alongside the real lint; run it locally whenever the script changes:
#   bash scripts/lint-workflows-test.sh
#
# Each case builds a throwaway "repo" holding only .github/workflows and the
# script, then runs the real script against stub `yq`/`docker`/`actionlint`
# on a PATH holding only those stubs. The stubs log what the script invoked
# and — for the YAML→JSON step — do a real conversion, so the assertions are
# about the script's own logic: which tool it reaches for, and which jobs it
# flags. No image pulls, no network. Needs jq plus one YAML→JSON backend
# (python3 + PyYAML, or a real mikefarah yq); see the probe below.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINT="$HERE/lint-workflows.sh"
FAILURES=0
WORKDIRS=()

# Invoked by the EXIT trap below, which shellcheck does not model, so it
# reads the function as dead code — under a different name per release:
# 0.11 (the pinned image, and since #340 what CI runs too) reports the
# function as never invoked (SC2329), while 0.9/0.10 — what GitHub runners
# ship — report its body as unreachable (SC2317), because this script's
# last statement is an unconditional `exit`. Only SC2329 is load-bearing
# now; SC2317 stays for anyone linting with an older shellcheck off PATH
# instead of `./scripts/lint-workflows.sh --images`.
# shellcheck disable=SC2329,SC2317
cleanup() {
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

# The lint script chooses each tool with `command -v`, so anything the
# ambient PATH happens to carry would quietly replace a stub — and the tools
# whose docker fallback the cases below assert on (yq, shellcheck) are
# exactly the ones a GitHub runner preinstalls. So the script runs with a
# PATH holding the case's stub dir and this: symlinks to the handful of
# utilities the script and the stubs call, and nothing else. `jq` is here
# rather than in every stub dir because only one case wants a broken one,
# and its stub dir comes first. Built first of all: the YAML→JSON probe
# below runs under this same PATH.
CORE_BIN="$(mktemp -d)"
WORKDIRS+=("$CORE_BIN")
for cmd in bash dirname find grep jq sed sort; do
  cmd_path="$(command -v "$cmd")" || {
    echo "this harness needs $cmd on PATH" >&2
    exit 1
  }
  ln -s "$cmd_path" "$CORE_BIN/$cmd"
done

# --- YAML→JSON, for the stubs ----------------------------------------------
# The stubs standing in for yq do a real conversion, so the assertions stay
# about the script's logic rather than a canned fixture. Two backends can
# do it, and either is enough: python3 + PyYAML (the usual local answer) or
# a real mikefarah yq (what GitHub runners preinstall — where PyYAML is not
# guaranteed, which is what kept this harness out of CI). Each is probed by
# actually converting a sample rather than by its version string, because
# `yq` is also the name of an unrelated jq wrapper taking different flags,
# and under $CORE_BIN — the same stripped PATH run_lint hands the script, so
# that a backend which only works under the ambient PATH is rejected here
# rather than dying inside every stub. The backend is baked in by absolute
# path, with shims resolved to the tool behind them.
HELPER_DIR="$(mktemp -d)"
WORKDIRS+=("$HELPER_DIR")
YAML2JSON="$HELPER_DIR/yaml2json" # <file>, or YAML on stdin
export YAML2JSON

write_backend() { # <python3|yq> — the converter, or 1 if the tool is absent
  local tool
  tool="$(command -v "$1")" || return 1
  case "$1" in
    python3)
      # pyenv/asdf/nix install a wrapper script under this name that
      # consults other PATH entries before exec'ing the interpreter; baking
      # the wrapper's path in would break it under the stripped PATH.
      # sys.executable is the interpreter the wrapper leads to, so the
      # PyYAML the probe below finds is the one that will be imported.
      tool="$("$tool" -c 'import sys; print(sys.executable)' 2> /dev/null)"
      [ -n "$tool" ] || return 1
      cat > "$YAML2JSON" <<EOF
#!/usr/bin/env bash
"$tool" -c 'import json,sys,yaml
json.dump(yaml.safe_load(open(sys.argv[1]) if len(sys.argv) > 1
                         else sys.stdin), sys.stdout)' "\$@"
EOF
      ;;
    yq)
      cat > "$YAML2JSON" <<EOF
#!/usr/bin/env bash
"$tool" -o=json '.' "\${1:--}"
EOF
      ;;
  esac
}

backend_works() { # both call shapes have to work: the yq stub is handed a
  # file, the docker stub is piped stdin. Run under $CORE_BIN, exactly as
  # the stubs will: a backend that resolves only under the ambient PATH
  # fails here and falls through to the next one, or to the error below,
  # instead of turning every case into a bogus "could not be parsed as YAML".
  local sample="$HELPER_DIR/probe.yml" want='{"jobs":{"a":{"t":3}}}' got
  printf 'jobs:\n  a:\n    t: 3\n' > "$sample"
  got="$(PATH="$CORE_BIN" "$YAML2JSON" "$sample" 2> /dev/null \
    | jq -cS . 2> /dev/null)"
  [ "$got" = "$want" ] || return 1
  got="$(PATH="$CORE_BIN" "$YAML2JSON" < "$sample" 2> /dev/null \
    | jq -cS . 2> /dev/null)"
  [ "$got" = "$want" ]
}

for backend in python3 yq; do
  rm -f "$YAML2JSON"
  write_backend "$backend" || continue
  chmod +x "$YAML2JSON"
  backend_works && break
done
backend_works || {
  echo "this harness needs a YAML→JSON converter: either python3 with" \
    "PyYAML (python3 -c 'import yaml') or mikefarah yq v4 on PATH" >&2
  exit 1
}

# Stubs. `yq` converts the file it is handed; `docker` logs its argv and,
# when it is standing in for yq, converts stdin the same way; `actionlint`
# and `shellcheck` are no-ops that can be told to fail.
# STUB_ACTIONLINT_EXIT / STUB_SHELLCHECK_EXIT control the exit code of
# whichever actionlint/shellcheck the script picked.
STUB_BIN="$(mktemp -d)"
WORKDIRS+=("$STUB_BIN")
cat > "$STUB_BIN/yq" <<'EOF'
#!/usr/bin/env bash
echo "yq $*" >> "$STUB_LOG"
"$YAML2JSON" "${@: -1}"
EOF
cat > "$STUB_BIN/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
case "$*" in
  *mikefarah/yq*)
    "$YAML2JSON"
    ;;
  *actionlint*)
    exit "${STUB_ACTIONLINT_EXIT:-0}"
    ;;
  *koalaman/shellcheck*)
    exit "${STUB_SHELLCHECK_EXIT:-0}"
    ;;
esac
EOF
cat > "$STUB_BIN/actionlint" <<'EOF'
#!/usr/bin/env bash
echo "actionlint $*" >> "$STUB_LOG"
exit "${STUB_ACTIONLINT_EXIT:-0}"
EOF
cat > "$STUB_BIN/shellcheck" <<'EOF'
#!/usr/bin/env bash
echo "shellcheck $*" >> "$STUB_LOG"
exit "${STUB_SHELLCHECK_EXIT:-0}"
EOF
chmod +x "$STUB_BIN/yq" "$STUB_BIN/docker" "$STUB_BIN/actionlint" \
  "$STUB_BIN/shellcheck"

# A stub dir without `yq`, to exercise the docker fallback for the parse,
# and one without a local `actionlint`/`shellcheck`, which is the normal
# case: neither is packaged for most machines.
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

# A stub dir with every tool installed except docker, for the --images cases
# below: forcing the pins on a machine with no docker has to fail loudly
# rather than fall back to the local binaries the flag exists to bypass.
NO_DOCKER_BIN="$(mktemp -d)"
WORKDIRS+=("$NO_DOCKER_BIN")
cp "$STUB_BIN/yq" "$STUB_BIN/actionlint" "$STUB_BIN/shellcheck" \
  "$NO_DOCKER_BIN/"
chmod +x "$NO_DOCKER_BIN/yq" "$NO_DOCKER_BIN/actionlint" \
  "$NO_DOCKER_BIN/shellcheck"

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
  STUB_LOG="$repo/stub.log" PATH="${STUB_PATH:-$NO_ACTIONLINT_BIN}:$CORE_BIN" \
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

# --- shellcheck over the repo's shell scripts (#291) -----------------------

# A shell script that is not the linter itself, so discovery has something
# to find beyond scripts/lint-workflows.sh.
extra_script() { # <repo> <relative path> [body]
  mkdir -p "$(dirname "$1/$2")"
  cat > "$1/$2" <<EOF
#!/usr/bin/env bash
${3:-echo hello}
EOF
}

# 16. The clean run announces the shellcheck pass and hands it every shell
#     script in the tree, the linter itself included.
r="$(new_repo)"
good_workflow "$r" ci
extra_script "$r" automation/dispatch.sh
run_lint "$r"
expect_eq "$(cat "$r/exit-code")" 0 "a shellcheck-clean tree exits 0"
expect_contains "$r/out" "shellcheck" "the clean run names the shellcheck check"
expect_contains "$r/stub.log" "automation/dispatch.sh" \
  "shellcheck is handed scripts outside scripts/"
expect_contains "$r/stub.log" "scripts/lint-workflows.sh" \
  "shellcheck is handed the linter itself"

# 17. shellcheck's findings fail the script, like actionlint's do.
r="$(new_repo)"
good_workflow "$r" ci
STUB_SHELLCHECK_EXIT=1 run_lint "$r"
expect_not_contains "$r/exit-code" "0" "a shellcheck finding fails the script"

# 18. Sourced files are followed (-x), so a hook that sources a shared
#     env.sh is not reported as an unfollowable source.
r="$(new_repo)"
good_workflow "$r" ci
run_lint "$r"
expect_contains "$r/stub.log" " -x " "shellcheck follows sourced files"

# 19. shellcheck runs from its pinned docker image when not installed.
r="$(new_repo)"
good_workflow "$r" ci
run_lint "$r"
expect_contains "$r/stub.log" "koalaman/shellcheck:" \
  "shellcheck falls back to its pinned docker image"

# 20. A locally installed shellcheck is preferred over the image.
r="$(new_repo)"
good_workflow "$r" ci
STUB_PATH="$STUB_BIN" run_lint "$r"
expect_contains "$r/stub.log" "shellcheck " \
  "a local shellcheck is used directly"
expect_not_contains "$r/stub.log" "koalaman/shellcheck" \
  "a local shellcheck skips the docker image"
# The -x case above only covers the image invocation; the two flag lists
# are written out separately, so each needs its own assertion.
expect_contains "$r/stub.log" " -x " \
  "a local shellcheck also follows sourced files"

# 21. No severity filter. shellcheck's `info` tier holds SC2086 and friends,
#     so a `--severity` floor would trade real bugs for quiet — including
#     quiet about the version-skew false positives it is tempting to reach
#     for it over (see the disable on cleanup() above). Those get a
#     line-level disable naming every code the releases in play emit.
r="$(new_repo)"
good_workflow "$r" ci
run_lint "$r"
expect_contains "$r/stub.log" "koalaman/shellcheck" \
  "the severity case really did run shellcheck"
expect_not_contains "$r/stub.log" "--severity" \
  "the shellcheck image runs with no severity filter"
STUB_PATH="$STUB_BIN" run_lint "$r"
expect_not_contains "$r/stub.log" "--severity" \
  "a local shellcheck runs with no severity filter"

# 22. Dependency and build trees are not ours to lint — thousands of vendored
#     scripts would drown the real findings (and slow the check to a crawl).
r="$(new_repo)"
good_workflow "$r" ci
extra_script "$r" ui/node_modules/some-pkg/install.sh
extra_script "$r" api/target/debug/build/gen.sh
extra_script "$r" .claude/worktrees/other/scripts/dev.sh
run_lint "$r"
expect_not_contains "$r/stub.log" "node_modules" \
  "node_modules is not shellchecked"
expect_not_contains "$r/stub.log" "api/target" \
  "build output is not shellchecked"
expect_not_contains "$r/stub.log" ".claude" \
  "worktrees parked under .claude are not shellchecked"

# --- annotated docker-image pins (#327) ------------------------------------

# Held in a variable rather than written inline: the pin check is line-based
# and would otherwise flag this harness's own fixture text.
pin='PINNED_IMAGE="busybox:1.36"'

# 23. A pinned image with no `# renovate:` annotation above it is invisible
#     to renovate and would rot silently, so the lint rejects it.
r="$(new_repo)"
good_workflow "$r" ci
extra_script "$r" scripts/thing.sh "$pin"
run_lint "$r"
expect_not_contains "$r/exit-code" "0" "an unannotated image pin exits non-zero"
expect_contains "$r/out" "scripts/thing.sh" \
  "an unannotated image pin names the file"
expect_contains "$r/out" "renovate" \
  "an unannotated image pin says what is missing"

# 24. With the annotation renovate needs, the same pin is fine.
r="$(new_repo)"
good_workflow "$r" ci
extra_script "$r" scripts/thing.sh "# renovate: datasource=docker
$pin"
run_lint "$r"
expect_eq "$(cat "$r/exit-code")" 0 "an annotated image pin is accepted"

# 25. The annotation has to be the renovate one — an ordinary comment above
#     the pin must not satisfy the check.
r="$(new_repo)"
good_workflow "$r" ci
extra_script "$r" scripts/thing.sh "# pinned deliberately
$pin"
run_lint "$r"
expect_not_contains "$r/exit-code" "0" \
  "an ordinary comment does not satisfy the annotation check"

# 26. An assignment with no pinned tag (an image chosen at runtime) has
#     nothing for renovate to track, so it must not be flagged.
r="$(new_repo)"
good_workflow "$r" ci
# The fixture is a literal line of a generated script, not an expansion.
# shellcheck disable=SC2016
extra_script "$r" scripts/thing.sh 'RUNTIME_IMAGE="$1"'
run_lint "$r"
expect_eq "$(cat "$r/exit-code")" 0 \
  "an unpinned image assignment is not flagged"

# --- deterministic mode: --images / KARI_LINT_FORCE_IMAGES (#340) ----------
# Whichever actionlint/shellcheck/yq a machine happens to have installed is
# not the version the pins name, and for shellcheck the difference is not
# only missing findings: 0.9 (what GitHub runners ship) reports a trap
# handler as SC2317 where 0.11 (the pin) reports SC2329, so a tree that is
# clean under one is red under the other. The flag skips every `command -v`
# probe so a run answers with the pins and nothing else — that is what CI
# passes, which makes the pins the single source of truth for "clean".

# 27. --images ignores an installed actionlint and runs the pin.
r="$(new_repo)"
good_workflow "$r" ci
STUB_PATH="$STUB_BIN" run_lint "$r" --images
expect_eq "$(cat "$r/exit-code")" 0 "--images on a clean tree exits 0"
expect_contains "$r/stub.log" "rhysd/actionlint:" \
  "--images runs actionlint from the pin"
expect_not_contains "$r/stub.log" "actionlint " \
  "--images ignores the installed actionlint"

# 28. ... and an installed shellcheck, which is the skew that motivated the
#     flag.
expect_contains "$r/stub.log" "koalaman/shellcheck:" \
  "--images runs shellcheck from the pin"
expect_not_contains "$r/stub.log" "shellcheck -x" \
  "--images ignores the installed shellcheck"

# 29. ... and an installed yq: one probe left in place is one version the
#     pins do not describe.
expect_contains "$r/stub.log" "mikefarah/yq" \
  "--images runs the YAML parse from the pin"
expect_not_contains "$r/stub.log" "yq -o=json" \
  "--images ignores the installed yq"

# 30. The env var is equivalent, so CI (or a shell profile) can force the
#     pins without editing every call site.
r="$(new_repo)"
good_workflow "$r" ci
KARI_LINT_FORCE_IMAGES=1 STUB_PATH="$STUB_BIN" run_lint "$r"
expect_eq "$(cat "$r/exit-code")" 0 "KARI_LINT_FORCE_IMAGES=1 exits 0"
expect_contains "$r/stub.log" "koalaman/shellcheck:" \
  "KARI_LINT_FORCE_IMAGES=1 runs shellcheck from the pin"
expect_not_contains "$r/stub.log" "shellcheck -x" \
  "KARI_LINT_FORCE_IMAGES=1 ignores the installed shellcheck"

# 31. A falsy value leaves the fast path alone: an exported 0 must not cost
#     every local run three image pulls.
r="$(new_repo)"
good_workflow "$r" ci
KARI_LINT_FORCE_IMAGES=0 STUB_PATH="$STUB_BIN" run_lint "$r"
expect_contains "$r/stub.log" "shellcheck -x" \
  "KARI_LINT_FORCE_IMAGES=0 still prefers the installed shellcheck"
expect_not_contains "$r/stub.log" "koalaman/shellcheck" \
  "KARI_LINT_FORCE_IMAGES=0 pulls no image"

# 32. Forcing the pins without docker fails, and fails before running
#     anything: silently falling back to the local binaries would hand back
#     exactly the answer the flag was used to avoid.
r="$(new_repo)"
good_workflow "$r" ci
STUB_PATH="$NO_DOCKER_BIN" run_lint "$r" --images
expect_not_contains "$r/exit-code" "0" "--images without docker exits non-zero"
expect_contains "$r/out" "docker" "--images without docker names docker"
expect_contains "$r/out" "--images" "--images without docker names the flag"
expect_eq "$(wc -c < "$r/stub.log")" 0 \
  "--images without docker runs no tools"
# The same tree without the flag is clean, so the failure above is the flag
# and not something wrong with the fixture.
STUB_PATH="$NO_DOCKER_BIN" run_lint "$r"
expect_eq "$(cat "$r/exit-code")" 0 "the same tree without --images is clean"

# 33. --help documents the flag; an undiscoverable switch is one nobody
#     reaches for when a local run disagrees with CI.
r="$(new_repo)"
good_workflow "$r" ci
run_lint "$r" --help
expect_contains "$r/out" "--images" "--help documents --images"
expect_contains "$r/out" "KARI_LINT_FORCE_IMAGES" \
  "--help documents the env var"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$FAILURES check(s) failed."
fi
exit $((FAILURES > 0))
