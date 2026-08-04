import { defineConfig, devices } from "@playwright/test";

// End-to-end tests. These build the app in test mode (ui/.env.test points at
// the shared test API + S3 bucket), serve the bundle with `vite preview`, and
// drive real user journeys in a browser:
//
// - smoke.spec.ts           network-independent app-shell checks
// - visitor.spec.ts         public pages render seeded content from test S3
// - admin-journeys.spec.ts  logged-in CRUD journeys against the test API
//
// Admin journeys log in through Auth0 once in a setup project and reuse the
// captured storageState. They only run when E2E_AUTH0_USERNAME and
// E2E_AUTH0_PASSWORD are set (they are in CI); without credentials the
// visitor/smoke suites still run and the admin projects are skipped.
const PORT = 4173;

export const ADMIN_STORAGE_STATE = "e2e/.auth/admin.json";

const hasAuthCredentials = Boolean(
  process.env.E2E_AUTH0_USERNAME && process.env.E2E_AUTH0_PASSWORD,
);

if (!hasAuthCredentials) {
  console.warn(
    "[playwright] E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD not set — " +
      "skipping the Auth0 setup and admin journey projects. " +
      "Visitor and smoke tests will still run.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",
  // Content assertions ride out test-environment latency (Render cold starts
  // are absorbed by a warm-up in the auth setup, but individual requests can
  // still be slow).
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  projects: [
    ...(hasAuthCredentials
      ? [
          {
            // Logs in through Auth0 once and saves storageState for the
            // admin project. Also warms up the (cold-startable) test API.
            name: "setup",
            testMatch: /auth\.setup\.ts/,
            timeout: 300_000,
          },
          {
            name: "admin",
            testMatch: /admin-journeys\.spec\.ts/,
            dependencies: ["setup"],
            // Admin journeys mutate shared test-bucket lists with whole-list
            // PUTs; all of them live in one file and fullyParallel: false
            // keeps that file's tests in a single worker, run one at a time,
            // so they can't clobber each other.
            fullyParallel: false,
            timeout: 240_000,
            use: { storageState: ADMIN_STORAGE_STATE },
          },
        ]
      : []),
    {
      name: "visitor",
      testIgnore: /admin-journeys\.spec\.ts/,
    },
  ],
  webServer: {
    // Build the test-mode bundle (real test API/S3 URLs from ui/.env.test)
    // then preview it, so journeys run against the shared test environment.
    command: `npm run build:test && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
