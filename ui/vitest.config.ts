import { defineConfig } from "vitest/config";

// Vitest configuration for unit/component tests. Kept separate from
// vite.config.ts so the build config stays focused on bundling.
//
// Which tests run, and in which environment, is defined per project in
// vitest.workspace.ts. What stays here is everything Vitest scopes to the
// whole run rather than to a project -- coverage above all, which must keep
// measuring every workspace's source across both projects.
export default defineConfig({
  test: {
    workspace: "./vitest.workspace.ts",
    coverage: {
      provider: "v8",
      // json-summary feeds the CI coverage comment on PRs.
      reporter: ["text", "html", "json-summary"],
      // Whole-app scope: every source file in every workspace counts, tested
      // or not, so the number reflects reality rather than a curated subset.
      // `test/` is deliberately absent — vitest's own default excludes cover
      // `test/**`, and what lives there is test code plus the readers those
      // tests drive.
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
      // `global` map holding EVERY measured file — not the leftovers (see
      // vitest/dist/coverage.js; its own doc comment says "global for all
      // other files", which is wrong about its own loop). So:
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
