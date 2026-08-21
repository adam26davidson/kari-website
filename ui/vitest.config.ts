import { defineConfig } from "vitest/config";

// Vitest configuration for unit/component tests. Kept separate from
// vite.config.ts so the build config stays focused on bundling.
//
// Which tests run, and in which environment, is defined per project in
// vitest.workspace.ts. What stays here is everything Vitest scopes to the
// whole run rather than to a project -- coverage above all, which must keep
// measuring all of src/ across both projects.
export default defineConfig({
  test: {
    workspace: "./vitest.workspace.ts",
    coverage: {
      provider: "v8",
      // json-summary feeds the CI coverage comment on PRs.
      reporter: ["text", "html", "json-summary"],
      // Whole-app scope: every file under src/ counts, tested or not, so the
      // number reflects reality rather than a curated subset.
      include: ["src/**"],
      // Ratchet floors: pinned just below current whole-app coverage so CI
      // fails on regressions. When coverage rises meaningfully, bump these
      // in the same PR (see CLAUDE.md). Floors, not targets — keep a small
      // margin below actuals to absorb V8 line-accounting drift.
      thresholds: {
        lines: 99.0,
        functions: 99.5,
        branches: 96.1,
      },
    },
  },
});
