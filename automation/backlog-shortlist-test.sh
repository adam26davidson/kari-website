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
# A comments read is a different canned file per issue: $GH_COMMENTS_DIR
# holds <number>.ndjson for the issues a test gave comments to, and an
# issue with none answers empty the way the real endpoint does.
if [[ "$*" == *"/comments"* ]]; then
  if [ "${GH_COMMENTS_EXIT:-0}" -ne 0 ]; then
    echo "stub: gh api comments failed" >&2
    exit "${GH_COMMENTS_EXIT}"
  fi
  number="$(sed -n 's#.*/issues/\([0-9]*\)/comments.*#\1#p' <<<"$*")"
  file="${GH_COMMENTS_DIR:-}/$number.ndjson"
  [ -f "$file" ] && cat "$file"
  exit 0
fi
if [ "${GH_STUB_EXIT:-0}" -ne 0 ]; then
  echo "stub: gh api failed" >&2
  exit "${GH_STUB_EXIT}"
fi
cat "$GH_RESPONSE"
EOF
  chmod +x "$work/gh"
  : >"$work/response.ndjson"
  mkdir -p "$work/comments"
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
  GH_COMMENTS_DIR="$work/comments" \
  GH_COMMENTS_EXIT="${COMMENTS_EXIT-0}" \
  KARI_SHORTLIST_GH_BIN="$work/gh" \
  KARI_SHORTLIST_PRODUCT_LIMIT="${PRODUCT_LIMIT-20}" \
  KARI_SHORTLIST_TOOLING_LIMIT="${TOOLING_LIMIT-10}" \
  KARI_SHORTLIST_DEPENDENT_LIMIT="${DEPENDENT_LIMIT-50}" \
    bash "$SHORTLIST" >"$work/out" 2>"$work/err"
  echo $? >"$work/exit-code"
}

# Canned comments for one issue, as `gh api --jq '.[].body'` emits them:
# the bodies, one per line.
comments_for() { # <workdir> <number> <body>...
  local work="$1" number="$2"
  shift 2
  printf '%s\n' "$@" >"$work/comments/$number.ndjson"
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
# tests can hand out dates independent of issue numbers. The body
# matters only to the unblocks count, which reads blocker references
# out of it, so it defaults to empty.
issue() { # <number> <created-day> <labels-csv> [title] [body]
  local labels_json
  labels_json="$(jq -cn --arg csv "$3" \
    '[$csv | split(",")[] | select(length > 0) | {name: .}]')"
  jq -cn --argjson n "$1" --arg day "$2" --argjson labels "$labels_json" \
    --arg title "${4:-issue $1}" --arg body "${5:-}" \
    '{number: $n, title: $title, body: $body,
      created_at: ("2026-08-\($day)T00:00:00Z"), labels: $labels}'
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

# --- priority: the maintainer's slice, above every other ----------------

work="$(new_work)"
{
  issue 200 10 "priority,automation,tooling"  # outranks provenance + topic
  issue 201 11 "priority,bug"                 # outranks bug
  issue 202 12 "bug"
  issue 203 13 "priority,blocked"             # discarded: still blocked
  issue 204 14 "priority,in progress"         # discarded: claimed
} >"$work/response.ndjson"
run_shortlist "$work"
expect_eq "$(jq -c '.priority | map(.number)' "$work/out")" "[200,201]" \
  "priority: takes every ready priority issue, whatever else it carries"
expect_eq "$(jq -c '.bugs | map(.number)' "$work/out")" "[202]" \
  "priority: wins over bug, so a priority bug leaves the bugs slice"
expect_eq "$(jq -c '.tooling | map(.number)' "$work/out")" "[]" \
  "priority: wins over tooling too"
expect_eq "$(jq -r '.ready' "$work/out")" 3 \
  "priority: discard labels still apply to a priority issue"

# --- unblocks: from bodies, from comments, open blockers only -----------

work="$(new_work)"
{
  issue 300 05 "automation"                   # the foundation
  issue 301 06 "automation"                   # ordinary polish
  issue 302 07 "has-dependencies" "dep a" "Depends on #300 for the shell."
  issue 303 08 "has-dependencies" "dep b" "Blocked by #300."
  issue 304 09 "has-dependencies" "dep c"     # blocker named only in a comment
  issue 305 10 "has-dependencies" "dep d" "Depends on #999."
} >"$work/response.ndjson"
comments_for "$work" 304 \
  "backlog-grooming: depends on #300 — needs the shell it introduces."
run_shortlist "$work"
expect_eq "$(jq -c '.product | map({number, unblocks})' "$work/out")" \
  '[{"number":300,"unblocks":3},{"number":301,"unblocks":0}]' \
  "unblocks: counts blocked issues naming it, from body and from comments"
expect_eq "$(jq -r '.dependents_scanned' "$work/out")" 4 \
  "unblocks: reads comments for every blocked issue"
expect_contains "$work/gh-log" "issues/304/comments" \
  "unblocks: a blocked issue's comments are read"
if grep -q "issues/300/comments" "$work/gh-log"; then
  echo "FAIL: unblocks: comments read for an unblocked issue"
  FAILURES=$((FAILURES + 1))
else
  echo "ok: unblocks: no comment call for an issue nothing is blocked on"
fi

# #999 is not in the open list, so #305 names a blocker that no longer
# gates anything — it must not earn #305's blocker a rank it cannot use.
expect_eq "$(jq -c '[.product[] | select(.unblocks > 0) | .number]' \
  "$work/out")" "[300]" \
  "unblocks: a closed blocker is not counted"

# --- unblocks counts blocked issues, not mentions of them ---------------

# Real re-pointing comments restate the link several times over (see
# #233, whose body names the old blocker and whose two comments each
# name the new one) — the prose below is that shape.
work="$(new_work)"
{
  issue 320 05 "automation"
  issue 321 06 "has-dependencies" "dep" \
    "Part of #212. **Blocked by #319** (admin app split)."
} >"$work/response.ndjson"
comments_for "$work" 321 \
  "Dependency repointed: #319 was closed in favour of three sequenced sub-issues. This issue's real prerequisite is now #320, which itself depends on #318. Keep \`has-dependencies\` until #320 ships." \
  "backlog-grooming: re-pointing this issue's blocker. The live blocker is **#320**: until Tailwind and shadcn are installed there is nothing here to rebuild against."
run_shortlist "$work"
expect_eq "$(jq -c '.product | map({number, unblocks})' "$work/out")" \
  '[{"number":320,"unblocks":1}]' \
  "unblocks: one blocked issue is one vote, however often it says so"

# --- unblocks outranks age within a slice -------------------------------

work="$(new_work)"
{
  issue 400 01 "automation"                   # oldest, gates nothing
  issue 401 02 "automation"                   # newer, gates two
  issue 402 03 "has-dependencies" "dep" "Depends on #401."
  issue 403 04 "has-dependencies" "dep" "Blocked by #401."
} >"$work/response.ndjson"
run_shortlist "$work"
expect_eq "$(jq -c '.product | map(.number)' "$work/out")" "[401,400]" \
  "ordering: most-unblocking first, age only as the tiebreak"

# --- the cap applies AFTER ranking, not before --------------------------

work="$(new_work)"
{
  issue 500 01 "automation"
  issue 501 02 "automation"
  issue 502 03 "automation"                   # newest, but gates one
  issue 503 04 "has-dependencies" "dep" "Depends on #502."
} >"$work/response.ndjson"
PRODUCT_LIMIT=2 run_shortlist "$work"
expect_eq "$(jq -c '.product | map(.number)' "$work/out")" "[502,500]" \
  "caps: the cap keeps the top-ranked, not the oldest N"
expect_eq "$(jq -r '.product_omitted' "$work/out")" 1 \
  "caps: ranking does not hide the omission count"

# --- the dependent scan is bounded, and says when it was ----------------

work="$(new_work)"
{
  issue 600 01 "automation"
  issue 601 02 "has-dependencies" "dep" "Depends on #600."
  issue 602 03 "has-dependencies" "dep" "Depends on #600."
} >"$work/response.ndjson"
DEPENDENT_LIMIT=1 run_shortlist "$work"
expect_eq "$(jq -r '.dependents_scanned' "$work/out")" 1 \
  "dependent cap: stops after the limit"
expect_eq "$(jq -r '.dependents_omitted' "$work/out")" 1 \
  "dependent cap: the unread remainder is counted, not silent"

# --- a failed comment read fails the script (never a partial ranking) ---

work="$(new_work)"
{
  issue 700 01 "automation"
  issue 701 02 "has-dependencies" "dep" "Depends on #700."
} >"$work/response.ndjson"
COMMENTS_EXIT=1 run_shortlist "$work"
expect_eq "$(cat "$work/exit-code")" 1 "comment failure: non-zero exit"
expect_eq "$(wc -c <"$work/out" | tr -d ' ')" 0 \
  "comment failure: no JSON emitted"

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
