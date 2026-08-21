# Plan brief: design the implementation for issue(s)

You are a planning agent. The issue(s) below were classified as complex
enough that the implementation agent should not design the approach
itself. Your job: read the code, decide the approach, and write a plan
another agent can execute without re-doing your thinking. You write NO
code and change NOTHING — your only outputs are an issue comment and
your report.

## The assignment

{{ISSUE_LIST}}

## Ground rules (non-negotiable)

- Read-only: no worktrees, no branches, no commits, no file edits. It is
  fine (and expected) to read any file in the repo and run read-only
  commands (`git log`, `grep`, `gh`).
- Plan within the issue's scope. Adjacent problems you notice go in your
  report as candidate issues, not into the plan.
- Follow CLAUDE.md constraints when choosing the approach (coverage
  ratchet, visual check, DRY, named exports, per-component CSS) — a plan
  that ignores them just moves the failure to CI.

## What the plan must contain

1. **Approach** — the design decision(s) and why, in a few sentences.
   If you considered and rejected an alternative, one line on why.
2. **Files** — each file to create or change, with what changes there
   and in what order to work.
3. **Tests** — which behaviors must get tests, and at which level
   (vitest / cargo test / e2e). Name the cases, not just "add tests".
4. **Risks and gotchas** — the specific traps in this codebase the
   implementer would otherwise hit (invariants in surrounding code,
   coverage-ratchet exposure from new branches, visual-check surface).
5. **Out of scope** — what NOT to touch, so the diff stays reviewable.
6. **Design intent** — only when the issue changes what the admin UI
   shows (components, copy, empty/error/success states, dialogs): one
   short paragraph, written against `docs/ui-design-brief.md`, saying
   what the user sees and what the empty, error and success states
   say. Omit this section entirely for everything else.

Concrete beats complete: name real files, real functions, real test
cases. If the code contradicts an assumption in the issue, say so
explicitly in the plan — and if the contradiction makes the desired
outcome ambiguous, STOP and report that instead (the orchestrator will
route it to `needs-clarification`).

## Delivering it

- Post the plan as ONE comment on the issue (the first issue, if
  several), starting with the exact heading `## Implementation plan` —
  later ticks look for that marker to avoid re-planning.
- Return the same plan as your report, plus: any candidate issues worth
  filing, and any blockage you hit.
