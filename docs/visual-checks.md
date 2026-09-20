# Visual Checks — reference detail

CLAUDE.md carries the requirement and the three steps every UI change must
run. This file is the reference detail: the script's flags, what CI's
review job needs, and how to reproduce something it reported.

## The capture script

`node e2e/screenshots.mjs`, run from `ui/` with the dev stack up. Add
`--routes /,/haiku` to limit it to affected pages; `--base-url` to target a
non-default server.

It defaults to `http://localhost:5174`, the ADMIN dev server, which proxies
everything outside `/admin` to the public one — so a single origin serves
both apps, as the deployed site and `npm run preview` do. Against a
`dev.sh` stack whose vite ports were bumped, pass the admin port it printed.

The `in ui/` is load-bearing, and it applies to any ad-hoc Playwright probe
you write too: Node resolves `@playwright/test` upward from the SCRIPT's
own directory, not from the cwd, so a probe dropped in `/tmp` or at the
repo root dies with `ERR_MODULE_NOT_FOUND` instead of finding
`ui/node_modules`. Put throwaway probes under `ui/e2e/` and run them from
`ui/`.

Full-page desktop + tablet + mobile PNGs land in `ui/e2e/screenshots/`, and
the script asserts no horizontal overflow at each captured width plus a few
assert-only widths (exits non-zero, naming the widest element, if a page
overflows). Admin pages (lists, editors, image cleanup) are captured too,
and need no credentials: since #266 the dev and test bundles sign
themselves in, so a machine with no Auth0 credentials captures exactly what
CI does. The admin pages are captured in their own browser context, so the
public pages are still photographed as a visitor sees them.

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

## Admin-only changes

Nothing special any more: run the capture, read the `admin-*.png` files,
and judge the change you actually made. Local capture and CI's see the same
pages (#266 removed the credential gate that used to make local runs
public-pages-only).

Two things to know about what the admin captures show. The fake session's
user is named "Kari", so the sidebar avatar and the home editor's greeting
render a plausible name rather than an empty one. And the API behind them
is the local seeded stack, so lists show fixture content, not a real
bucket's.

If a capture shows the sign-in screen instead of the admin shell, the
bundle was built without `VITE_AUTH_MODE=fake` — you are pointing at a
staging/production build, not a dev or test one.
