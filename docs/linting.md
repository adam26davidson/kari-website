# Workflow and Shell Linting

Reference detail for `./scripts/lint-workflows.sh`. CLAUDE.md carries the
rule (run it before pushing any change to a `*.sh` file or to
`.github/workflows/*`); this file is what you read when you are changing
one of those files or when a local run disagrees with CI.

## What it checks

`./scripts/lint-workflows.sh` runs five checks:

1. actionlint over `.github/` — schema, action inputs, `${{ }}`
   expressions, and shellcheck over every embedded `run:` script.
2. Every job sets a job-level `timeout-minutes`, and every step that
   calls a local action (`uses: ./.github/actions/...`) sets a step-level
   one too: a composite action's own steps cannot carry a timeout, so the
   calling step is the only place its setup can be bounded separately
   from the job.
3. shellcheck over every `*.sh` in the repo.
4. Every pinned docker image in those scripts carries the
   `# renovate: datasource=docker` comment that `renovate.json`'s
   customManager keys off (without it the pin is invisible to Renovate).
   Pin-shaped lines inside a heredoc body are skipped — they are text a
   script prints, not assignments. Every delimiter form closes its
   heredoc: bare (`<<EOF`), quoted with any characters (`<<"END-X"`,
   `<<'a.b'`), backslash-quoted (`<<\EOF`) and tab-stripped (`<<-EOF`);
   a `<<` inside a one-line `((...))` or `$((...))` is a left shift and
   opens nothing. The check is a line scan, not a shell parser, so some
   shapes still misread: a `<<WORD` inside a string, or in arithmetic it
   cannot see (`let`, `$[...]`, a `((` spanning lines), reads as an
   opener, and a partly quoted delimiter (`E"O"F`) is read short. A
   misread heredoc never closes, and that fails the check rather than
   exempting the rest of the file.
5. No line of a `*.sh` file or of any YAML under `.github/` is longer than
   80 characters (AGENTS.md's line-width convention), counted in
   characters rather than bytes, so `—` is one column.

## Wrapping a long line

Check 5 has no exemption marker; every line it has met so far wrapped
without one. The shapes that are not plain prose, and how they wrap
without changing behaviour:

- A long command: `\` continuation, or `&&` / `||` / `|` at the end of
  the line.
- A long `echo` message: split it into two arguments on a `\`
  continuation — echo joins them with the single space the split
  removed.
- A long expected-output string in a test: build it in a variable with
  `+=`, or factor the repeated part (a flag list, a token block) into one.
- `VAR="${OVERRIDE:-long default}"`: assign the override first, then
  `VAR="${VAR:-long default}"`.
- A YAML `if:` or `env:` value: a `>-` folded scalar — its line breaks
  become spaces, which is harmless inside an expression.
- A `${{ }}` value that must not gain spaces (a cache `key:`, a URL):
  `${{ format('{0}-{1}', a, b) }}` inside a `>-` scalar, broken between
  arguments. For a run URL in a `run:` script, use the runner's
  `$GITHUB_SERVER_URL`, `$GITHUB_REPOSITORY` and `$GITHUB_RUN_ID` instead.

Nothing to install — actionlint, shellcheck and yq each fall back to a
pinned docker image when the binary is missing, so there is never a reason
to hand-roll a `docker run koalaman/shellcheck` of your own.

This is the script CI's `shell-lint` job runs.

## `--images`, and why a local run can disagree with CI

CI runs it as `--images`, which ignores installed binaries and uses the
pins for every tool. An installed shellcheck is whatever release the
machine has, and releases disagree about real findings: 0.9 reds a trap
handler as SC2317 that the pinned 0.11 reports as SC2329.

So if a local run disagrees with CI, re-run with `--images` (or
`KARI_LINT_FORCE_IMAGES=1`) — that, not your `shellcheck --version`, is the
definition of clean.

## The shell test harnesses

CI's `shell-lint` job also runs the shell test harnesses
`automation/dispatch-test.sh`, `scripts/setup-worktree-test.sh`,
`scripts/dev-api-test.sh` and `scripts/lint-workflows-test.sh`.

Changing the lint script? Re-run its tests:
`bash scripts/lint-workflows-test.sh` (needs jq plus either python3 +
PyYAML or a real mikefarah yq, whichever the machine has). The harness
runs the lint on a PATH holding only its stubs and the short list of
utilities in `CORE_BIN_CMDS` at the top of the test script; if the lint
starts calling anything else (`awk`, `cat`, ...), every case that reaches
it fails with a message naming that list — add the command there.
