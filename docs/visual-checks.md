# Visual Checks — reference detail

CLAUDE.md carries the requirement and the three steps every UI change must
run. This file is what you read when the change is admin-only and you have
no Auth0 credentials, or when you are reproducing something CI's visual
review reported.

## The capture script

`node e2e/screenshots.mjs`, run from `ui/` with the dev stack up. Add
`--routes /,/haiku` to limit it to affected pages; `--base-url` to target a
non-default server.

The `in ui/` is load-bearing, and it applies to any ad-hoc Playwright probe
you write too: Node resolves `@playwright/test` upward from the SCRIPT's
own directory, not from the cwd, so a probe dropped in `/tmp` or at the
repo root dies with `ERR_MODULE_NOT_FOUND` instead of finding
`ui/node_modules`. Put throwaway probes under `ui/e2e/` and run them from
`ui/`.

Full-page desktop + tablet + mobile PNGs land in `ui/e2e/screenshots/`, and
the script asserts no horizontal overflow at each captured width plus a few
assert-only widths (exits non-zero, naming the widest element, if a page
overflows). Admin pages (lists, editors, image cleanup) are captured too
when `E2E_AUTH0_USERNAME` / `E2E_AUTH0_PASSWORD` are set (as they are in
CI); without them the script captures the public pages only and says so.

## CI's visual review

CI runs the same check on PRs touching `ui/**`
(`.github/workflows/visual-review.yml`): it captures the same screenshots
against the seeded e2e stack and Claude reviews them, posting an advisory
sticky PR comment (needs the `CLAUDE_CODE_OAUTH_TOKEN` repo secret, from
`claude setup-token` — usage draws from the Claude Pro/Max subscription,
deliberately never API credits; skips with a notice when absent).

Advisory means treat findings as a reviewer's notes — address or create
github issues for them, but the job never blocks a merge.

To reproduce a finding CI reported, download the exact images the reviewer
saw rather than recreating them locally:

```
gh run download <run-id> -n visual-review-screenshots
```

## Admin-only changes without local credentials

When a change is confined to components only the admin pages render (e.g.
`tiptap.tsx`, reachable only through the admin blog post editor) and you
have no `E2E_AUTH0_*` env vars, local capture cannot exercise what you
changed.

Still run it, but know its purpose there is narrower: the
horizontal-overflow assertions plus a public-page regression baseline,
nothing more. Don't over-invest in studying public PNGs that cannot show
your change — CI's visual review is the authoritative appearance check for
admin pages, and say so in the PR.

Issue #266 (compile-time-gated fake auth) is the real fix — it would let
local capture cover admin pages without Auth0 credentials.
