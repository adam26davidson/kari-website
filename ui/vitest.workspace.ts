import { defineWorkspace, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

// The suite splits into two projects along what each test actually needs from
// the runtime:
//
// - "unit" holds the app and shared-package component/unit tests, which
//   render React and therefore need jsdom. It spans every workspace
//   (apps/public, apps/admin, packages/shared): one run, one coverage
//   number, which is what the CI ratchet reads.
// - "config" holds tests that assert on this package's own tooling and on
//   invariants that span the workspaces — the eslint ignore derivation, the
//   bundle-budget plugin, the app-boundary guard, and the CSS design
//   invariants, which read stylesheets from BOTH apps. They drive real tool
//   APIs or the filesystem and never touch the DOM, so standing up a jsdom
//   environment and the DOM test setup for them is pure overhead.
//
// Coverage stays in vitest.config.ts: it is configured once and measured
// across both projects, over every workspace's source.
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

export default defineWorkspace([
  {
    plugins: [react()],
    test: {
      ...shared,
      name: "unit",
      environment: "jsdom",
      setupFiles: ["./test/setup.ts"],
      include: ["{apps,packages}/*/src/**/*.test.{ts,tsx}"],
      // Playwright specs live in e2e/ and must not be run by Vitest. Config
      // tests are excluded here because the "config" project below owns them.
      exclude: [...configDefaults.exclude, "e2e/**", configTests],
      // Components import their own .css files; we don't need to process them
      // for logic/render tests.
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
]);
