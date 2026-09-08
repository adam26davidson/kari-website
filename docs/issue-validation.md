# Independent validation of agent-filed issues

An agent finding is a hypothesis. Capture it immediately, but do not
claim it, plan its implementation, or implement it until a separate
research session confirms it against the codebase. This is a process
rule, not a GitHub permission or scripted gate.

## Scope and independence

- Apply to agent-originated findings: `automation` issues, bodies or
  comments identifying an agent report, and findings relayed by another
  agent. GitHub authorship is not evidence of human origin: the fleet
  uses the maintainer's credentials. Record the originating model and
  source report/PR when filing; write `unknown` rather than guessing.
- Existing backlog without validation is pending by default. Missing
  provenance with no clear human request also requires validation.
- An issue recording an explicit maintainer request is human-directed,
  even if an agent typed it. Cite that direction. It still needs normal
  scope/readiness and worker premise checks. A `priority` or `bug` label
  by itself never substitutes for validation of an agent finding.
- Use the validation model in `automation/agents/issue-pipeline.md`,
  "Dispatching subagents", through the existing Claude runner. Always
  start a fresh session separate from the finder/filer; even a finding
  from the judgment tier needs another session. Do not resume the
  finding session or let the orchestrator self-certify. Codex runner
  support is future work.
- If the required model is unavailable or research fails, leave the
  issue unclaimed and retry on a later tick. Never downgrade or treat
  inability to reproduce as proof that the issue is valid or invalid.

## Research and durable evidence

Use `automation/templates/validation-brief.md`. Research is read-only
with respect to project code: inspect current `origin/main`, trace the
relevant execution path, read tests and project constraints, and check
related issues and merged work. Fetch first; if it fails, defer rather
than certify stale code. Do not disturb an implementation worktree.

Try a focused non-destructive reproduction or existing test when
practical. Record exactly what ran and its result; if none ran, state
why and give the code evidence instead. No production actions, fixes,
new implementation branches, or unrelated backlog expansion.

Post ONE comment on EACH issue starting `## Issue validation`, recording:

- Validator model and that this is an independent session.
- Reviewed `origin/main` commit SHA and the issue scope reviewed.
- Concrete files/functions and the path from trigger to observed impact.
- Reproduction/test commands and results, or limits of static evidence.
- Counterevidence: intentional behavior, existing safeguards, duplicates,
  already-landed fixes, and relevant requirements/design guidance.
- Verdict: `VALIDATED`, `INVALID`, `ALREADY_FIXED`, `DUPLICATE`, or
  `NEEDS_CLARIFICATION`, with reasons and any canonical issue/merged PR.

`VALIDATED` means the reported problem or gap exists and its requested
outcome is supported by requirements. A possible improvement or code
smell alone is insufficient. New product choices need maintainer input.
A validation report is neither an implementation plan nor PR review.

## Handling the result

The validator posts evidence and returns it; the orchestrator handles
labels. Immediately re-read state/labels before any mutation and leave
closed or already-claimed issues alone.

- `VALIDATED`: eligible for normal readiness, priority, overlap, and
  planning checks. Include the validation comment URL in the assignment.
- Other verdicts: do not implement. Add `needs-clarification` so future
  ticks do not repeat the investigation. Leave closure/deduplication to
  normal grooming or human triage; cite evidence rather than silently
  deleting the finding. For an actual product decision, use the existing
  maintainer ask protocol.
- An interrupted/failed validation produces no approval. Defer and log
  the failure; do not add a human-blocking label for a model outage.

## Reuse and freshness

A heading or label alone is not approval: read the report and evidence.
Reuse only a complete `VALIDATED` report covering the current scope.
Check later body edits and comments for changed claims, requirements,
contradictory evidence, and merged fixes. Compare relevant files against
the reviewed SHA (`git diff <reviewed-sha>..origin/main -- <paths>`);
unrelated merges do not invalidate evidence. Changed relevant behavior,
expanded scope (including umbrella folds), or uncheckable evidence
requires a fresh validation. A later non-valid verdict supersedes an
older approval. Removing a blocking label does not restore approval.

Recheck immediately before claiming and at worker entry. Every member
of a combined assignment must pass; a released claim or saved plan is
not an exception. Workers still verify the premise during implementation
and stop if it contradicts validation. Existing active PRs continue
through their current review gate; do not disrupt live workers to
retroactively validate them. Reclaimed work uses the new rule.
