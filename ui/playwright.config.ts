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
// - admin-assistant.spec.ts       the helper panel's resting state
// - admin-auth0-login.spec.ts     the one REAL Auth0 login journey
//
// The test-mode bundle signs itself in (#266: ui/.env.test sets
// VITE_AUTH_MODE=fake, and the API accepts the matching dev token), so
// every admin journey below runs with NO Auth0 credentials, locally and in
// CI. The single exception is admin-auth0-login.spec.ts, which drives the
// real Universal Login so the actual Auth0 integration cannot rot
// unnoticed; its project is built only when E2E_AUTH0_USERNAME and
// E2E_AUTH0_PASSWORD are set (they are in CI).
export const PORT = 4173;

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

/**
 * A file-name pattern, anchored to the last path segment.
 *
 * Playwright matches `testMatch` / `testIgnore` against a spec's ABSOLUTE
 * path, so a bare `/admin-.*\.spec\.ts/` also matches every spec in a
 * checkout whose directory happens to contain "admin-" — which a worktree
 * named for the issue it is working on very easily does
 * (`kari-website-admin-shadcn-shell`). There the visitor project ignored
 * ALL FOUR specs and `npm run test:e2e` exited with "No tests found"
 * rather than running anything, which is the worst possible failure for a
 * suite: a green-looking run that tested nothing.
 *
 * The anchoring is only half of it, and the half that is easy to get
 * wrong: `[\\/]` in front and `$` behind pin the pattern to ONE segment
 * only if the pattern itself cannot cross a separator. `.` matches `/`,
 * so `[\\/]admin-.*\.spec\.ts$` still matches
 * `…/admin-anything/ui/e2e/visitor.spec.ts` and reproduces the exact
 * failure above in any checkout whose directory STARTS with `admin-`.
 * So a wildcard here is `[^\\/]*`, never `.*`.
 */
const SPEC = (pattern: RegExp) =>
  new RegExp(`[\\\\/]${pattern.source}$`);

const hasAuthCredentials = Boolean(
  process.env.E2E_AUTH0_USERNAME && process.env.E2E_AUTH0_PASSWORD,
);

if (!hasAuthCredentials) {
  console.warn(
    "[playwright] E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD not set — " +
      "skipping the real-Auth0 login smoke. Everything else, the admin " +
      "journeys included, runs on the test bundle's fake auth.",
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
    {
      // Not a login any more (the bundle signs itself in): just the
      // fail-fast check that the local API and its seeded MinIO are up,
      // so a missing stack says so once instead of timing out a dozen
      // content assertions. Every admin project depends on it.
      name: "setup",
      testMatch: SPEC(/stack\.setup\.ts/),
      timeout: 300_000,
    },
    {
      name: "admin",
      testMatch: SPEC(/admin-journeys\.spec\.ts/),
      dependencies: ["setup"],
      // Admin journeys mutate shared test-bucket lists with whole-list
      // PUTs; all of them live in one file and fullyParallel: false
      // keeps that file's tests in a single worker, run one at a time,
      // so they can't clobber each other.
      fullyParallel: false,
      timeout: 240_000,
    },
    {
      // The whats-on-test page reads and never writes, and both
      // endpoints it reads are intercepted by the spec — so it needs
      // neither the serial execution the mutating journeys above
      // require nor their long timeouts, and gets its own project
      // rather than slowing that file down.
      name: "admin-status",
      testMatch: SPEC(/admin-whats-on-test\.spec\.ts/),
      dependencies: ["setup"],
    },
    {
      // The helper (#214) only reads: opening the panel creates no
      // conversation, and with no ANTHROPIC_API_KEY on the e2e stack
      // it never reaches a model at all. So, like the status page
      // above, it needs neither serial execution nor a long timeout.
      name: "admin-assistant",
      testMatch: SPEC(/admin-assistant\.spec\.ts/),
      dependencies: ["setup"],
    },
    ...(hasAuthCredentials
      ? [
          {
            // The only credential-gated project left: a real Universal
            // Login round trip against the real tenant. Its long timeout
            // is Auth0's, not ours.
            name: "auth0-login",
            testMatch: SPEC(/admin-auth0-login\.spec\.ts/),
            dependencies: ["setup"],
            timeout: 300_000,
          },
        ]
      : []),
    {
      // The admin specs belong to the projects above (which wait on the
      // stack check, and one of which needs credentials), so none of them
      // belong to this one.
      name: "visitor",
      testIgnore: SPEC(/admin-[^\\/]*\.spec\.ts/),
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
