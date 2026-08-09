import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

// Vitest configuration for unit/component tests. Kept separate from
// vite.config.ts so the build config stays focused on bundling.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Playwright specs live in e2e/ and must not be run by Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
    // Components import their own .css files; we don't need to process them
    // for logic/render tests.
    css: false,
    // Default values for the Vite env vars the app reads at import time.
    // Individual tests can override with vi.stubEnv().
    env: {
      VITE_API_URL: "https://api.test.local",
      VITE_S3_URL: "https://s3.test.local",
    },
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
        lines: 94,
        functions: 91,
        branches: 92,
      },
    },
  },
});
