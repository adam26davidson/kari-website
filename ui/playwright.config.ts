import { defineConfig, devices } from "@playwright/test";

// End-to-end tests. These run against a fully local, hermetic stack: a
// throwaway MinIO stands in for S3 (started via docker, seeded with fixture
// content by e2e/seed.mjs — see that file's header for the docker command)
// and the real API runs on localhost:3000 against it. The app is built in
// test mode (ui/.env.test points at both), served with `vite preview`, and
// driven through real user journeys in a browser:
//
// - smoke.spec.ts                 network-independent app-shell checks
// - visitor.spec.ts               public pages render the seeded fixture
//                                 content
// - admin-journeys.spec.ts        logged-in CRUD journeys against the local
//                                 API
// - admin-whats-on-test.spec.ts   the read-only deployment-status page, with
//                                 its two external endpoints intercepted
//
// Admin specs log in through Auth0 once in a setup project and reuse the
// captured storageState. They only run when E2E_AUTH0_USERNAME and
// E2E_AUTH0_PASSWORD are set (they are in CI); without credentials the
// visitor/smoke suites still run and the admin projects are skipped.
export const PORT = 4173;

export const ADMIN_STORAGE_STATE = "e2e/.auth/admin.json";

/**
 * The commit sha baked into the bundle these tests run against — a made-up
 * but well-formed 40-character sha, so the admin "What's on test" page
 * behaves as it does on a deployed environment (deploy.yml bakes the real
 * one in) instead of short-circuiting to its "this isn't the test site"
 * copy.
 *
 * It is set here rather than in `.env.test` on purpose. `.env.test` is also
 * what the visual-review workflow's `npm run build:test` reads, and that
 * bundle is driven by e2e/screenshots.mjs, which intercepts nothing — a head
 * sha there would send every capture off to karidavidson.com and
 * api.github.com for real. Scoped to this webServer, only
 * admin-whats-on-test.spec.ts sees it, and that file mocks every request the
 * page makes.
 */
export const E2E_COMMIT_SHA = "e2e11ead0000000000000000000000000000cafe";

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
  // Generous timeouts: content assertions wait on API round trips and the
  // local S3, plus real Auth0 redirects in the admin journeys.
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
            // admin project; first checks the local API is up and healthy.
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
          {
            // The whats-on-test page reads and never writes, and both
            // endpoints it reads are intercepted by the spec — so it needs
            // neither the serial execution the mutating journeys above
            // require nor their long timeouts, and gets its own project
            // rather than slowing that file down.
            name: "admin-status",
            testMatch: /admin-whats-on-test\.spec\.ts/,
            dependencies: ["setup"],
            use: { storageState: ADMIN_STORAGE_STATE },
          },
        ]
      : []),
    {
      // Every admin-*.spec.ts needs the login the setup project captures,
      // so none of them belong to this credential-free project.
      name: "visitor",
      testIgnore: /admin-.*\.spec\.ts/,
    },
  ],
  webServer: {
    // Build the test-mode bundle (local API/S3 URLs from ui/.env.test)
    // then preview it, so journeys run against the local e2e stack.
    command: `npm run build:test && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Vite reads VITE_-prefixed variables from the environment too, where
    // they beat .env.test — which is how the head sha reaches this bundle
    // and only this one (see E2E_COMMIT_SHA above).
    env: { VITE_COMMIT_SHA: E2E_COMMIT_SHA },
  },
});
