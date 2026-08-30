#!/usr/bin/env bash
# The issue-pipeline's Phase B candidate feed. Prints a bounded JSON
# shortlist of open issues, sliced the way Phase B orders its picks, so
# a tick never has to read the whole backlog (~130 issues and growing)
# to choose one.
#
#   bugs        every open issue labelled `bug`, oldest first
#   maintainer  maintainer-filed product work (no `automation` label —
#               filed by a human, not the fleet — and not `tooling`)
#   product     agent-filed product work (`automation` without
#               `tooling`), oldest KARI_SHORTLIST_PRODUCT_LIMIT
#   tooling     machinery work (`tooling`), oldest
#               KARI_SHORTLIST_TOOLING_LIMIT
#
# An issue appears in at most one slice (`bug` wins over the others),
# and issues carrying any discard label — in progress, has-dependencies,
# needs-clarification, idea, blocked, needs-human, duplicate — appear in
# none. Every slice is sorted by created_at ascending: the issue number
# is a proxy that happens to be monotonic, never the ordering key
# (#484). The `*_omitted` counts make the caps visible — a slice that
# silently dropped its tail would read exactly like a complete one,
# which is how #484's truncated candidate list impersonated a working
# oldest-first rule for three days. `bugs` and `maintainer` are
# uncapped: both are small by nature, and if either balloons that is a
# backlog problem the counts in this output make visible.
#
# Fetches via the paginated REST API rather than `gh issue list`, for
# two reasons: `gh issue list` needs a --limit that silently truncates
# once the backlog outgrows it, and label EXCLUSION there would need
# the search index, which lags label changes by minutes — a just-claimed
# issue must not be offered to the next tick. --paginate is complete by
# construction and reads live data.
#
# Env overrides:
#   KARI_SHORTLIST_GH_BIN         default gh — the test harness's stub seam
#   KARI_AUTOMATION_JQ_BIN        default jq (same knob as telegram.sh)
#   KARI_SHORTLIST_PRODUCT_LIMIT  default 20
#   KARI_SHORTLIST_TOOLING_LIMIT  default 10
#
# Tests: automation/backlog-shortlist-test.sh
set -euo pipefail

GH_BIN="${KARI_SHORTLIST_GH_BIN:-gh}"
JQ_BIN="${KARI_AUTOMATION_JQ_BIN:-jq}"
PRODUCT_LIMIT="${KARI_SHORTLIST_PRODUCT_LIMIT:-20}"
TOOLING_LIMIT="${KARI_SHORTLIST_TOOLING_LIMIT:-10}"

# One object per line; --paginate follows Link headers to the end, so
# the read is complete however large the backlog grows. A gh failure
# fails the assignment and, via set -e, the script — Phase B must stop
# on a partial view, never act on one.
raw="$("$GH_BIN" api --paginate \
  'repos/{owner}/{repo}/issues?state=open&sort=created&direction=asc&per_page=100' \
  --jq '.[]')"

# shellcheck disable=SC2016 # $plim/$tlim are jq variables (--argjson),
# so the single quotes are the point, not a mistake.
printf '%s\n' "$raw" | "$JQ_BIN" -s \
  --argjson plim "$PRODUCT_LIMIT" \
  --argjson tlim "$TOOLING_LIMIT" '
  def discard: ["in progress", "has-dependencies", "needs-clarification",
                "idea", "blocked", "needs-human", "duplicate"];
  # The issues endpoint returns PRs too; a PR is never a candidate.
  map(select(has("pull_request") | not))
  | map({number, title, created_at, labels: [.labels[].name]})
  | sort_by(.created_at)                       # not by number (#484)
  | . as $open
  | ($open | map(select((.labels - discard) == .labels))) as $ready
  | ($ready | map(select(.labels | index("bug")))) as $bugs
  | ($ready | map(select((.labels | index("bug") | not)
      and (.labels | index("automation") | not)
      and (.labels | index("tooling") | not)))) as $maint
  | ($ready | map(select((.labels | index("bug") | not)
      and (.labels | index("automation"))
      and (.labels | index("tooling") | not)))) as $prod
  | ($ready | map(select((.labels | index("bug") | not)
      and (.labels | index("tooling"))))) as $tool
  | {
      total_open: ($open | length),
      ready: ($ready | length),
      bugs: $bugs,
      maintainer: $maint,
      product: ($prod | .[0:$plim]),
      product_omitted: ([($prod | length) - $plim, 0] | max),
      tooling: ($tool | .[0:$tlim]),
      tooling_omitted: ([($tool | length) - $tlim, 0] | max)
    }'
