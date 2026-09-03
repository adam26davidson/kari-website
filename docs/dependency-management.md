# Dependency Management

Reference detail for this repo's dependency policy. CLAUDE.md points here
before you add, remove or upgrade a dependency by hand, and whenever
`npm ci` warns or fails to resolve.

## Install scripts (`allowScripts`)

npm 12 (what recent Node ships locally) blocks a dependency's install
scripts unless `allowScripts` in `ui/package.json` covers it, and ends the
install with a warning naming everything it skipped.

Every dependency that ships one is recorded there as `false` — reviewed and
denied, not overlooked:

- the four `@fortawesome/*` scripts and `browser-tabs-lock`'s only
  `console.log` a banner
- `@swc/core`'s quietly swaps in a `@swc/wasm` fallback we would rather
  fail loudly without

(`esbuild`'s entry retired with #529: vite 8 bundles rolldown, so esbuild is
no longer in the tree at all — and rolldown's own platform binaries ship
script-free.)

Nothing needs to run, so `npm ci` is warning-free. That is the point of
recording them: a warning appearing again means a NEW script arrived.
Review it — `npm install-scripts ls` lists it — then
`npm install-scripts deny <pkg>` (or `approve <pkg>`, if it genuinely must
run) and commit the `package.json` change.

Never silence it with `--dangerously-allow-all-scripts`.

CI is on Node 22 / npm 10, which predates the field and ignores it, so this
is about local output and local intent.

## The eslint-plugin-jsx-a11y peer override

`overrides` in `ui/package.json` pins `eslint-plugin-jsx-a11y`'s `eslint`
peer to `$eslint` (whatever the root resolves). Without it `npm ci` fails
`ERESOLVE`: the plugin's last release (6.10.2, October 2024) declares
`eslint@^3 || … || ^9`, and this package is on eslint 10.

The plugin itself runs fine under 10 — `jsx-a11y/alt-text`, the one rule
the config enables, still fires; #528 tracks removing the override once
upstream ships a release that accepts eslint 10. This is a stale peer
RANGE, not a stale plugin, so prefer the override to dropping the plugin
(that would silently lose the alt-text check).

Don't reach for `--legacy-peer-deps` — it would have to be threaded through
every `npm ci` in CI.

## Renovate

Dependency updates are managed by Renovate (`renovate.json`); non-major
updates auto-merge once CI passes. The exception is a package still below
1.0.0, where a "minor" bump is breaking by convention (cargo and npm
alike): those are labelled `major-update` and wait for a human, while 0.x
patch bumps still auto-merge.

To validate `renovate.json`, pin the version:

```
npx --yes --package renovate@latest renovate-config-validator renovate.json
```

A bare `--package renovate` can resolve a stale cached major that rejects
current config keys (a renovate 37 in the npx cache rejected
`managerFilePatterns`).
