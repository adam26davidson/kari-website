import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

// Vitest configuration for unit/component tests. Kept separate from
// vite.config.ts so the build config stays focused on bundling.
//
// Which tests run, and in which environment, is defined per project in the
// `projects` block below. Everything Vitest scopes to the whole run rather
// than to a project stays outside it -- coverage above all, which must keep
// measuring every workspace's source across both projects.
//
// The two projects lived in their own vitest.workspace.ts until #529: vitest
// 4 removed the workspace file (and `defineWorkspace` with it) in favour of
// this inline `projects` array. Same two projects, same settings.

// The suite splits into two projects along what each test actually needs from
// the runtime:
//
// - "unit" holds the app and shared-package component/unit tests, which
//   render React and therefore need jsdom. It spans every workspace
//   (apps/public, apps/admin, packages/shared): one run, one coverage
//   number, which is what the CI ratchet reads.
// - "config" holds tests that assert on this package's own tooling and on
//   invariants that span the workspaces -- the eslint ignore derivation, the
//   bundle-budget plugin, the app-boundary guard, and the CSS design
//   invariants, which read stylesheets from BOTH apps. They drive real tool
//   APIs or the filesystem and never touch the DOM, so standing up a jsdom
//   environment and the DOM test setup for them is pure overhead.
const configTests = "test/**/*.test.ts";

// Shared by both projects so a test reads the same way wherever it lives.
const shared = {
  globals: true,
  // Default values for the Vite env vars the app reads at import time.
  // Individual tests can override with vi.stubEnv().
  env: {
    VITE_API_URL: "https://api.test.local",
    VITE_S3_URL: "https://s3.test.local",
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          ...shared,
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./test/setup.ts"],
          include: ["{apps,packages}/*/src/**/*.test.{ts,tsx}"],
          // Playwright specs live in e2e/ and must not be run by Vitest.
          // Config tests are excluded here because the "config" project
          // below owns them.
          exclude: [...configDefaults.exclude, "e2e/**", configTests],
          // Components import their own .css files; we don't need to
          // process them for logic/render tests.
          css: false,
        },
      },
      {
        test: {
          ...shared,
          name: "config",
          environment: "node",
          include: [configTests],
        },
      },
    ],
    coverage: {
      provider: "v8",
      // json-summary feeds the CI coverage comment on PRs.
      reporter: ["text", "html", "json-summary"],
      // Whole-app scope: every source file in every workspace counts, tested
      // or not, so the number reflects reality rather than a curated subset.
      // `test/` is deliberately absent — vitest's own default excludes cover
      // `test/**`, and what lives there is test code plus the readers those
      // tests drive.
      //
      // vitest 4 dropped `coverage.all`, which used to be what pulled in
      // untested files. `include` now does that job on its own: every file
      // matching it is reported whether a test touched it or not, so the
      // whole-source scope above survives the upgrade unchanged.
      include: ["apps/*/src/**", "packages/*/src/**"],
      // Ratchet floors: pinned just below current coverage so CI fails on
      // regressions. When coverage rises meaningfully, bump these in the
      // same PR (see CLAUDE.md). Floors, not targets — keep a small margin
      // below actuals to absorb V8 line-accounting drift, which is real: V8
      // versions disagree about how many functions a file has, so the same
      // tree measures slightly differently on Node 22 (CI) and on a newer
      // local Node (#398). Measure on CI before tightening these; the
      // coverage job's comment carries a row per workspace for exactly that.
      //
      // A floor per workspace ON TOP OF the whole-run floors (#593), not
      // instead of them. The two layers police different things, because
      // vitest's glob groups are NOT a partition: `resolveThresholds` builds
      // one coverage map per glob from the files that glob matches, and a
      // `global` map holding EVERY measured file — not the leftovers. Its
      // own doc comment ("global for all other files") is wrong about its
      // own loop, but the loop is unambiguous, and vitest 4 spells the
      // intent out in a second comment right above it: "Global threshold is
      // for all files, even if they are included by glob patterns"
      // (packages/vitest/src/node/coverage.ts upstream; shipped in
      // vitest/dist/chunks/coverage.*.js). So:
      //   - the per-workspace groups stop one workspace's regression from
      //     hiding behind another's headroom, which the admin app (a third
      //     of the source) is big enough to do;
      //   - the top-level numbers are the backstop for anything no group
      //     names — a fourth workspace under `apps/*/src/**` would otherwise
      //     be measured, counted in the PR comment, and policed by nothing.
      // test/config/coverage-thresholds.test.ts pins both layers, because a
      // glob matching nothing enforces nothing and still passes.
      thresholds: {
        lines: 99.5,
        functions: 99.9,
        branches: 97.4,
        "apps/public/src/**": { lines: 99.4, functions: 99.9, branches: 95.4 },
        "apps/admin/src/**": { lines: 99.1, functions: 99.9, branches: 96.9 },
        "packages/shared/src/**": {
          lines: 99.5,
          functions: 99.9,
          branches: 98.1,
        },
      },
    },
  },
});
