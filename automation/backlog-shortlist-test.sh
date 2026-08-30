#!/usr/bin/env bash
# Test harness for automation/backlog-shortlist.sh. Runs in CI (the
# shell-lint job) and locally; run it whenever the shortlist script
# changes:
#   bash automation/backlog-shortlist-test.sh
#
# Hermetic by construction: every run points KARI_SHORTLIST_GH_BIN at a
# recording stub that replays a canned issue list, so the harness never
# reads the real backlog and needs no credentials. Needs jq — the same
# dependency the script itself has.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHORTLIST="$HERE/backlog-shortlist.sh"
FAILURES=0
WORKDIRS=()

cleanup() {
  for d in "${WORKDIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

# Every test gets its own workdir, its own stub and its own logs, so no
# assertion can be satisfied by a leftover from the test before it.
new_work() {
  local work
  work="$(mktemp -d)"
  : >"$work/gh-log"
  # The gh stub: the full argv on one line, then the canned response —
  # one JSON object per line, the shape `gh api --paginate --jq '.[]'`
  # emits. GH_STUB_EXIT lets a test exercise the failure path.
  cat >"$work/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
if [ "${GH_STUB_EXIT:-0}" -ne 0 ]; then
  echo "stub: gh api failed" >&2
  exit "${GH_STUB_EXIT}"
fi
cat "$GH_RESPONSE"
EOF
  chmod +x "$work/gh"
  : >"$work/response.ndjson"
  WORKDIRS+=("$work")
  echo "$work"
}

# GH_LOG/GH_RESPONSE/GH_STUB_EXIT ride along in the environment: the
# script execs the stub directly, so the prefix's environment is what
# it sees. Slice limits are overridable per call via PRODUCT_LIMIT /
# TOOLING_LIMIT.
run_shortlist() { # <workdir> — stdout in <workdir>/out, stderr in err
  local work="$1"
  GH_LOG="$work/gh-log" \
  GH_RESPONSE="$work/response.ndjson" \
  GH_STUB_EXIT="${GH_STUB_EXIT-0}" \
  KARI_SHORTLIST_GH_BIN="$work/gh" \
  KARI_SHORTLIST_PRODUCT_LIMIT="${PRODUCT_LIMIT-20}" \
  KARI_SHORTLIST_TOOLING_LIMIT="${TOOLING_LIMIT-10}" \
    bash "$SHORTLIST" >"$work/out" 2>"$work/err"
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

# A one-line issue object for the canned response. Labels are a
# comma-separated list; created_at descends from the day so ordering
# tests can hand out dates independent of issue numbers.
issue() { # <number> <created-day> <labels-csv> [title]
  local labels_json
  labels_json="$(jq -cn --arg csv "$3" \
    '[$csv | split(",")[] | select(length > 0) | {name: .}]')"
  jq -cn --argjson n "$1" --arg day "$2" --argjson labels "$labels_json" \
    --arg title "${4:-issue $1}" \
    '{number: $n, title: $title, created_at: ("2026-08-\($day)T00:00:00Z"),
      labels: $labels}'
}

# --- slicing: every routing rule in one fixture -------------------------

work="$(new_work)"
{
  issue 90 10 "bug,automation,tooling"        # bug wins over tooling
  issue 91 11 "bug"                           # plain bug
  issue 92 12 ""                              # maintainer-filed product
  issue 93 13 "enhancement"                   # maintainer-filed product
  issue 94 14 "automation"                    # agent-filed product
  issue 95 15 "automation,tooling"            # tooling
  issue 96 16 "tooling"                       # tooling (maintainer-filed)
  issue 97 17 "automation,in progress"        # discarded: claimed
  issue 98 18 "bug,blocked"                   # discarded: blocked beats bug
  # A PR rides the same endpoint; must never be a candidate.
  issue 99 19 "" | jq -c '. + {pull_request: {url: "x"}}'
} >"$work/response.ndjson"
run_shortlist "$work"
expect_eq "$(cat "$work/exit-code")" 0 "slicing: exits 0"
expect_eq "$(jq -c '.bugs | map(.number)' "$work/out")" "[90,91]" \
  "slicing: bug slice takes every open bug, tooling or not"
expect_eq "$(jq -c '.maintainer | map(.number)' "$work/out")" "[92,93]" \
  "slicing: maintainer slice is unlabelled-by-automation product work"
expect_eq "$(jq -c '.product | map(.number)' "$work/out")" "[94]" \
  "slicing: product slice is agent-filed non-tooling"
expect_eq "$(jq -c '.tooling | map(.number)' "$work/out")" "[95,96]" \
  "slicing: tooling slice ignores provenance"
expect_eq "$(jq -r '.total_open' "$work/out")" 9 \
  "slicing: PR excluded from total_open"
expect_eq "$(jq -r '.ready' "$work/out")" 7 \
  "slicing: discard labels excluded from ready"

# --- ordering: created_at, never issue number (#484) --------------------

work="$(new_work)"
{
  issue 500 20 "bug"    # newest date, lowest... no: highest number
  issue 300 05 "bug"    # oldest date
  issue 400 12 "bug"
} >"$work/response.ndjson"
run_shortlist "$work"
expect_eq "$(jq -c '.bugs | map(.number)' "$work/out")" "[300,400,500]" \
  "ordering: slices sort by created_at ascending"

# --- caps: visible, and they keep the OLDEST ----------------------------

work="$(new_work)"
{
  issue 10 03 "automation"
  issue 11 01 "automation"
  issue 12 02 "automation"
  issue 13 04 "tooling"
} >"$work/response.ndjson"
PRODUCT_LIMIT=2 TOOLING_LIMIT=1 run_shortlist "$work"
expect_eq "$(jq -c '.product | map(.number)' "$work/out")" "[11,12]" \
  "caps: product keeps the oldest N"
expect_eq "$(jq -r '.product_omitted' "$work/out")" 1 \
  "caps: product omission is counted, not silent"
expect_eq "$(jq -r '.tooling_omitted' "$work/out")" 0 \
  "caps: tooling omission is 0 when nothing dropped"

# --- the query itself: paginated, oldest-first at the source ------------

expect_contains "$work/gh-log" "--paginate" \
  "query: gh api is paginated (no --limit truncation)"
expect_contains "$work/gh-log" "sort=created&direction=asc" \
  "query: server-side oldest-first"

# --- empty backlog ------------------------------------------------------

work="$(new_work)"
run_shortlist "$work"
expect_eq "$(cat "$work/exit-code")" 0 "empty: exits 0"
expect_eq "$(jq -r '.total_open' "$work/out")" 0 "empty: total_open 0"
expect_eq "$(jq -c '.bugs' "$work/out")" "[]" "empty: empty slices"

# --- gh failure fails the script (never a partial view) -----------------

work="$(new_work)"
GH_STUB_EXIT=1 run_shortlist "$work"
expect_eq "$(cat "$work/exit-code")" 1 "gh failure: non-zero exit"
expect_eq "$(wc -c <"$work/out" | tr -d ' ')" 0 \
  "gh failure: no JSON emitted"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "backlog-shortlist-test: all tests passed"
else
  echo "backlog-shortlist-test: $FAILURES failure(s)"
  exit 1
fi
