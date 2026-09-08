#!/usr/bin/env bash
# The issue-pipeline's Phase B candidate feed. Prints a bounded JSON
# shortlist of open issues, sliced the way Phase B orders its picks, so
# a tick never has to read the whole backlog (~180 issues and growing)
# to choose one.
#
#   priority    every open issue labelled `priority` — the maintainer's
#               own "do this next", uncapped
#   bugs        every open issue labelled `bug`, oldest first
#   maintainer  maintainer-filed product work (no `automation` label —
#               filed by a human, not the fleet — and not `tooling`)
#   product     agent-filed product work (`automation` without
#               `tooling`), top KARI_SHORTLIST_PRODUCT_LIMIT
#   tooling     machinery work (`tooling`), top
#               KARI_SHORTLIST_TOOLING_LIMIT
#
# An issue appears in at most one slice (`priority` wins over `bug`,
# `bug` over the rest), and issues carrying any discard label — in
# progress, has-dependencies, needs-clarification, idea, blocked,
# needs-human, duplicate — appear in none. `priority` is the
# maintainer's label alone: no agent adds or removes it, which is what
# makes it a channel a human can rely on rather than another signal the
# fleet talks to itself with.
#
# Within every slice, issues are ordered by `unblocks` descending and
# then `created_at` ascending — most-unblocking first, oldest as the
# tiebreak. The issue number is a proxy that happens to be monotonic,
# never the ordering key (#484).
#
# `unblocks` is how many OPEN issues name this one as a blocker: the
# fix for a pick order whose only inputs were label and age, and so
# could not tell that #592 gates ten other issues while the polish
# ahead of it gates none (#774). Blockers are read from where the
# backlog already writes them down — the body of every open
# `has-dependencies` issue, plus its comments, where the groomer's
# `backlog-grooming: depends on #N` and its duplicate-repointing live.
# Only those issues' comments are fetched (`dependents_scanned`), since
# an issue nothing is blocked on contributes nothing to the count, and
# only OPEN blockers are counted — a closed one no longer gates
# anything. The count is derived, never stored: no label to go stale,
# and any tick can be checked against the issues it read.
#
# The `*_omitted` counts make the caps visible — a slice that silently
# dropped its tail would read exactly like a complete one, which is how
# #484's truncated candidate list impersonated a working oldest-first
# rule for three days. `priority`, `bugs` and `maintainer` are
# uncapped: all three are small by nature, and if one balloons that is
# a backlog problem the counts in this output make visible.
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
#   KARI_SHORTLIST_DEPENDENT_LIMIT default 50 — how many blocked issues
#                                 to read comments for, one API call each
#
# Tests: automation/backlog-shortlist-test.sh
set -euo pipefail

GH_BIN="${KARI_SHORTLIST_GH_BIN:-gh}"
JQ_BIN="${KARI_AUTOMATION_JQ_BIN:-jq}"
PRODUCT_LIMIT="${KARI_SHORTLIST_PRODUCT_LIMIT:-20}"
TOOLING_LIMIT="${KARI_SHORTLIST_TOOLING_LIMIT:-10}"
DEPENDENT_LIMIT="${KARI_SHORTLIST_DEPENDENT_LIMIT:-50}"

# One object per line; --paginate follows Link headers to the end, so
# the read is complete however large the backlog grows. A gh failure
# fails the assignment and, via set -e, the script — Phase B must stop
# on a partial view, never act on one.
raw="$("$GH_BIN" api --paginate \
  'repos/{owner}/{repo}/issues?state=open&sort=created&direction=asc&per_page=100' \
  --jq '.[]')"

# The blocked issues, oldest first — the only ones whose comments say
# anything about what gates what. Capped so a backlog that fills up
# with blocked issues cannot turn one tick into hundreds of API calls;
# the cap is reported rather than applied silently.
# shellcheck disable=SC2016 # $dlim is a jq variable (--argjson).
dependents="$(printf '%s\n' "$raw" | "$JQ_BIN" -s -r \
  --argjson dlim "$DEPENDENT_LIMIT" '
  map(select(has("pull_request") | not))
  | map(select([.labels[].name] | index("has-dependencies")))
  | sort_by(.created_at)
  | .[0:$dlim][].number')"

dependents_total="$(printf '%s\n' "$raw" | "$JQ_BIN" -s -r '
  map(select(has("pull_request") | not))
  | map(select([.labels[].name] | index("has-dependencies")))
  | length')"

# One call per blocked issue. A failure here fails the script for the
# same reason a failed issue read does: a shortlist ranked on half the
# dependency graph looks exactly like one ranked on all of it.
dependent_comments='[]'
dependents_scanned=0
while read -r n; do
  [ -n "$n" ] || continue
  comment_bodies="$("$GH_BIN" api --paginate \
    "repos/{owner}/{repo}/issues/$n/comments?per_page=100" \
    --jq '.[].body')"
  # shellcheck disable=SC2016 # $n/$text are jq variables (--argjson/--arg).
  dependent_comments="$("$JQ_BIN" -c \
    --argjson n "$n" --arg text "$comment_bodies" \
    '. + [{number: $n, text: $text}]' <<<"$dependent_comments")"
  dependents_scanned=$((dependents_scanned + 1))
done <<<"$dependents"

# shellcheck disable=SC2016 # $plim/$tlim/etc are jq variables
# (--argjson), so the single quotes are the point, not a mistake.
printf '%s\n' "$raw" | "$JQ_BIN" -s \
  --argjson plim "$PRODUCT_LIMIT" \
  --argjson tlim "$TOOLING_LIMIT" \
  --argjson comments "$dependent_comments" \
  --argjson scanned "$dependents_scanned" \
  --argjson deptotal "$dependents_total" '
  def discard: ["in progress", "has-dependencies", "needs-clarification",
                "idea", "blocked", "needs-human", "duplicate"];
  # Blocker references, as the backlog actually writes them: a clause
  # naming a dependency, and every issue it points at. Split on
  # sentence and line breaks first so an unrelated "#123" elsewhere in
  # a long body is not swept in by a phrase paragraphs away.
  def blocker_refs:
    [ ascii_downcase
      | splits("[.\n]")
      | select(test("depends on|depend on|dependent on|blocked by|blocked on|waiting on|waits on|blocker|prerequisite"))
      | scan("#([0-9]+)")
      | .[0]
      | tonumber
    ]
    # One blocked issue is one vote however many comments restate the
    # link: a re-pointing grooming comment says the same thing several
    # times over, and a count of mentions is not a count of blocked
    # work. (No apostrophes in here — the whole program is single
    # quoted, so one would end it mid-comment.)
    | unique;
  # The issues endpoint returns PRs too; a PR is never a candidate.
  map(select(has("pull_request") | not))
  | sort_by(.created_at)                       # not by number (#484)
  | . as $full
  | ($full | map({number, title, created_at, labels: [.labels[].name]}))
    as $open
  | ($open | map(.number)) as $open_numbers
  | ( [ $full[]
        | select([.labels[].name] | index("has-dependencies"))
        | . as $dep
        | ((.body // "") + "\n"
           + (first($comments[] | select(.number == $dep.number) | .text)
              // ""))
        | blocker_refs[]
      ]
      # A closed blocker gates nothing, so it earns no rank.
      | map(select(. as $b | $open_numbers | index($b)))
      | group_by(.)
      | map({key: (.[0] | tostring), value: length})
      | from_entries
    ) as $unblocks
  | def rank: map(. + {unblocks: ($unblocks[(.number | tostring)] // 0)})
              | sort_by([-(.unblocks), .created_at]);
    ($open | map(select((.labels - discard) == .labels)) | rank) as $ready
  | ($ready | map(select(.labels | index("priority")))) as $prio
  | ($ready | map(select((.labels | index("priority") | not)
      and (.labels | index("bug"))))) as $bugs
  | ($ready | map(select((.labels | index("priority") | not)
      and (.labels | index("bug") | not)
      and (.labels | index("automation") | not)
      and (.labels | index("tooling") | not)))) as $maint
  | ($ready | map(select((.labels | index("priority") | not)
      and (.labels | index("bug") | not)
      and (.labels | index("automation"))
      and (.labels | index("tooling") | not)))) as $prod
  | ($ready | map(select((.labels | index("priority") | not)
      and (.labels | index("bug") | not)
      and (.labels | index("tooling"))))) as $tool
  | {
      total_open: ($open | length),
      ready: ($ready | length),
      dependents_scanned: $scanned,
      dependents_omitted: ([$deptotal - $scanned, 0] | max),
      priority: $prio,
      bugs: $bugs,
      maintainer: $maint,
      product: ($prod | .[0:$plim]),
      product_omitted: ([($prod | length) - $plim, 0] | max),
      tooling: ($tool | .[0:$tlim]),
      tooling_omitted: ([($tool | length) - $tlim, 0] | max)
    }'
