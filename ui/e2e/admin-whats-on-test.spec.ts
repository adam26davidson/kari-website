import { expect, Page, test } from "@playwright/test";
import { E2E_COMMIT_SHA } from "../playwright.config";

// The admin "What's on test" page (#265), driven in a real browser against
// the built test-mode bundle.
//
// The page answers "which merged changes are on test but not live yet?" by
// asking two things outside this stack: production's own /version endpoint,
// and GitHub's REST API. Both are intercepted here, so the suite stays
// hermetic (no network, no 60/hour unauthenticated GitHub budget) and every
// state is reachable on demand rather than whenever the real deployment
// history happens to produce it. A guard route fails the test if any other
// request to those two hosts escapes.
//
// The bundle is built with a head sha (E2E_COMMIT_SHA, wired in by
// playwright.config.ts's webServer) because without one the page renders its
// "this isn't the test site" copy and calls nothing at all — the state every
// non-deployed build is in, and the one the unit tests in
// apps/admin/src/admin-whats-on-test-page/ cover.
//
// Read-only: nothing here touches the test bucket, so unlike
// admin-journeys.spec.ts these tests need no cleanup and no serialization.

/**
 * The two external endpoints the page reads. Kept in step by hand with
 * packages/shared/src/services/deploy-status.ts — the e2e suite is its own
 * TypeScript project and cannot import from the apps (the same reason
 * e2e/config.mjs re-derives the S3 key shape).
 */
const PROD_VERSION_URL = "https://karidavidson.com/api/version";
const GITHUB_REPO_URL =
  "https://api.github.com/repos/adam26davidson/kari-website";

/** The sha the mocked production reports for itself. */
const PROD_SHA = "b0bbeef000000000000000000000000000001234";

const isVersionRequest = (url: URL) => url.href === PROD_VERSION_URL;
const isDeploymentsRequest = (url: URL) =>
  url.href.startsWith(`${GITHUB_REPO_URL}/deployments`);
const isCompareRequest = (url: URL) =>
  url.href.startsWith(`${GITHUB_REPO_URL}/compare/`);
const isExternalRequest = (url: URL) =>
  url.hostname === "api.github.com" || url.hostname === "karidavidson.com";

interface MockResponse {
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * A JSON response the browser will accept from another origin. The
 * allow-origin header is not decoration: Playwright fulfils the request,
 * but the browser still applies CORS to a cross-origin fetch, and without
 * it every mock would surface as a network failure.
 */
function jsonResponse(body: unknown): MockResponse {
  return {
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

/** A failing response, as a flaky GitHub or a down production would give. */
function errorResponse(status: number): MockResponse {
  return {
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ message: "e2e mock failure" }),
  };
}

/**
 * Answer every request matching `matcher` with `response`, recording the
 * URLs asked for in `seen` when given. Routes registered later win, so a
 * test can re-answer an endpoint (the retry case below) by calling this
 * again rather than unrouting.
 */
async function mock(
  page: Page,
  matcher: (url: URL) => boolean,
  response: MockResponse,
  seen?: string[],
) {
  await page.route(matcher, async (route) => {
    seen?.push(route.request().url());
    await route.fulfill(response);
  });
}

/** A commit as GitHub's compare API returns it (oldest first). */
function compareCommit(
  sha: string,
  message: string,
  committerDate: string | null,
  authorDate: string | null,
) {
  return {
    sha,
    commit: {
      message,
      committer: committerDate ? { date: committerDate } : null,
      author: authorDate ? { date: authorDate } : null,
    },
  };
}

const OLDER_COMMIT = compareCommit(
  "1111111111111111111111111111111111111111",
  "Give the haiku list a calmer empty state (#601)\n\nBody, ignored.",
  "2026-08-19T09:30:00Z",
  "2026-08-18T09:30:00Z",
);

// No PR suffix and no committer date, so the fallbacks in
// deploy-status.ts's toPendingCommit are exercised too.
const NEWER_COMMIT = compareCommit(
  "2222222222222222222222222222222222222222",
  "Hotfix pushed straight to main",
  null,
  "2026-08-20T14:00:00Z",
);

const section = (page: Page) => page.locator(".admin-whats-on-test-page");

/**
 * Open the page and wait until it has settled into a real state — the
 * version footer on success, the error card on failure. A bundle built
 * without a head sha renders neither, which is the one failure worth
 * naming: it means the preview being tested is not the one this config
 * builds.
 */
async function openWhatsOnTest(page: Page) {
  await page.goto("/admin/whats-on-test");
  await expect(section(page)).toBeVisible({ timeout: 60_000 });
  await expect(
    section(page)
      .locator(".whats-on-test-shas")
      .or(section(page).locator(".load-error")),
    "The page rendered neither its version footer nor an error, which means " +
      "the bundle under test carries no VITE_COMMIT_SHA. Stop any stale " +
      "`npm run preview` on the e2e port and let playwright build its own.",
  ).toBeVisible({ timeout: 60_000 });
}

test.describe("admin: what's on test", () => {
  /** Requests to the two external hosts that no test mocked. */
  let unexpected: string[];

  test.beforeEach(async ({ page }) => {
    unexpected = [];
    // Registered first, so every mock a test adds takes precedence.
    await page.route(isExternalRequest, async (route) => {
      unexpected.push(route.request().url());
      await route.fulfill(errorResponse(599));
    });
  });

  test.afterEach(() => {
    expect(
      unexpected,
      "the page reached an external endpoint the test did not mock",
    ).toEqual([]);
  });

  test("lists the merged changes waiting to go live", async ({ page }) => {
    await mock(page, isVersionRequest, jsonResponse({ sha: PROD_SHA }));
    const compared: string[] = [];
    await mock(
      page,
      isCompareRequest,
      jsonResponse({
        total_commits: 2,
        commits: [OLDER_COMMIT, NEWER_COMMIT],
      }),
      compared,
    );

    await openWhatsOnTest(page);

    // The staging-only menu entry is registered and owns this route — only
    // the VITE_SHOW_TEST_STATUS builds have it at all.
    const menuItem = page.locator(".admin-menu-item", {
      hasText: "What's on test",
    });
    await expect(menuItem).toHaveClass(/selected/);
    await expect(menuItem).toHaveAttribute("href", "/admin/whats-on-test");

    // The compare ran between exactly the two shas in play.
    expect(compared).toEqual([
      `${GITHUB_REPO_URL}/compare/${PROD_SHA}...${E2E_COMMIT_SHA}`,
    ]);

    // Newest merge on top, though GitHub returns the range oldest first.
    const items = section(page).locator(".whats-on-test-commit");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Hotfix pushed straight to main");
    await expect(items.nth(0).locator("code")).toHaveText("2222222");
    // No "(#N)" suffix on that subject, so no PR link either.
    await expect(items.nth(0).locator(".whats-on-test-pr-link")).toHaveCount(0);
    // Committer date missing, so the author date is shown.
    await expect(items.nth(0)).toContainText("Aug 20, 2026");

    await expect(items.nth(1)).toContainText(
      "Give the haiku list a calmer empty state",
    );
    // The PR number is lifted out of the squash subject into a link.
    await expect(items.nth(1)).not.toContainText("(#601)");
    const prLink = items.nth(1).locator(".whats-on-test-pr-link");
    await expect(prLink).toHaveText("#601");
    await expect(prLink).toHaveAttribute(
      "href",
      "https://github.com/adam26davidson/kari-website/pull/601",
    );
    await expect(items.nth(1)).toContainText("Aug 19, 2026");

    // Both versions are named at the foot of the page, shortened.
    const shas = section(page).locator(".whats-on-test-shas");
    await expect(shas).toContainText(E2E_COMMIT_SHA.slice(0, 7));
    await expect(shas).toContainText(PROD_SHA.slice(0, 7));
    // No truncation warning: the range's total matches what was listed.
    await expect(section(page).locator(".whats-on-test-warning")).toHaveCount(
      0,
    );
  });

  test("says so when test and live are the same", async ({ page }) => {
    // Production reports the very sha the bundle was built from, so there
    // is nothing to compare and the compare call must not happen at all —
    // the guard route in beforeEach fails the test if it does.
    await mock(page, isVersionRequest, jsonResponse({ sha: E2E_COMMIT_SHA }));

    await openWhatsOnTest(page);

    await expect(section(page).locator(".whats-on-test-note")).toContainText(
      "the same right now",
    );
    await expect(section(page).locator(".whats-on-test-commit")).toHaveCount(0);
  });

  test("says so when nothing has ever been promoted to live", async ({
    page,
  }) => {
    // No /version endpoint on production yet (a 404 from the SPA fallback),
    // so the page falls back to scanning GitHub's production deployments —
    // and finds none that ever succeeded. This is the state the deployed
    // page is actually in until the first prod promotion is approved.
    await mock(page, isVersionRequest, errorResponse(404));
    await mock(page, isDeploymentsRequest, jsonResponse([]));

    await openWhatsOnTest(page);

    await expect(section(page).locator(".whats-on-test-note")).toContainText(
      "hasn't been published from here yet",
    );
    await expect(section(page).locator(".whats-on-test-commit")).toHaveCount(0);
    // The test site's own version is still reported.
    await expect(section(page).locator(".whats-on-test-shas")).toContainText(
      E2E_COMMIT_SHA.slice(0, 7),
    );
  });

  test("offers a retry when the lookup fails, and recovers", async ({
    page,
  }) => {
    await mock(page, isVersionRequest, errorResponse(404));
    await mock(page, isDeploymentsRequest, errorResponse(500));

    await openWhatsOnTest(page);

    const error = section(page).locator(".load-error");
    await expect(error).toContainText(
      "Failed to load what's waiting to go live.",
    );
    await expect(section(page).locator(".whats-on-test-shas")).toHaveCount(0);

    // Fix the endpoint (a later route wins) and retry in place — no reload,
    // so this is the page's own retry path, not a fresh mount.
    await mock(page, isDeploymentsRequest, jsonResponse([]));
    await error.getByRole("button", { name: "Retry" }).click();

    await expect(section(page).locator(".load-error")).toHaveCount(0);
    await expect(section(page).locator(".whats-on-test-note")).toContainText(
      "hasn't been published from here yet",
    );
  });
});
