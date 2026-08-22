import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame, Locator, Page, Request } from "@playwright/test";
import { expect } from "@playwright/test";
import { TEST_API_URL, TINY_PNG_BASE64 } from "./config.mjs";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

// The test-environment backend URLs. e2e/config.mjs owns the .env.test
// parsing and precedence rules; re-exported here for the specs' convenience.
export { TEST_API_URL, TEST_S3_URL, originalKey } from "./config.mjs";

/**
 * A unique marker for content created by a test, so parallel or retried runs
 * never collide and cleanup can find exactly what this attempt created.
 */
export function uniqueMarker(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A tiny valid 1x1 PNG, written into e2e/fixtures/ (gitignored) so file
 * choosers have a real file on disk to pick.
 */
export function pngFixturePath(): string {
  const fixturesDir = path.join(E2E_DIR, "fixtures");
  const filePath = path.join(fixturesDir, "tiny.png");
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(TINY_PNG_BASE64, "base64"));
  }
  return filePath;
}

// --- Admin UI helpers -------------------------------------------------------
// The admin controls are icon-only buttons (FontAwesome renders
// <svg data-icon="...">), so selectors go through the icon name.

export function iconButton(scope: Page | Locator, icon: string): Locator {
  return scope.locator(`.admin-icon-button:has(svg[data-icon="${icon}"])`);
}

/** Answer the "Are you sure?" dialog the admin page shows before mutations. */
export async function confirmDialog(page: Page, label: "Yes" | "No") {
  const dialog = page.locator(".admin-confirmation");
  await expect(dialog).toBeVisible();
  await dialog.locator(".admin-button", { hasText: label }).click();
  await expect(dialog).toBeHidden();
}

/** Wait until no blocking "Loading/Saving..." overlay is up. */
export async function waitForIdle(page: Page, timeout = 60_000) {
  await expect(page.locator(".admin-loading")).toBeHidden({ timeout });
}

export type AdminSection =
  | "Home"
  | "Haiku"
  | "Haiga"
  | "Photography"
  | "Other works";

/** The API endpoint each admin section fetches its list from on mount. */
const SECTION_LIST_ENDPOINT: Record<AdminSection, string> = {
  Home: "/home-page",
  Haiku: "/haiku",
  Haiga: "/haiga",
  Photography: "/photography",
  "Other works": "/blog",
};

/**
 * Open /admin (already authenticated via storageState) and switch to the
 * given section, waiting for its list to finish loading.
 */
export async function openAdminSection(page: Page, section: AdminSection) {
  const listUrl = TEST_API_URL + SECTION_LIST_ENDPOINT[section];
  // The "Loading..." overlay only appears after the section component's
  // mount effect runs, so waitForIdle alone can pass before loading has
  // even started — leaving the list at its initial empty state and letting
  // cleanup miss rows that exist but haven't rendered yet. The section's
  // list fetch is a positive signal that the load actually happened: once
  // its response arrives, the overlay is up and is hidden in the same
  // React commit that populates the list.
  //
  // The wait is scoped to requests issued by the post-goto document while
  // still being registered before goto, reconciling two concerns:
  // - registering before goto means a fast response is never missed (Home
  //   fetches on initial mount, potentially before an after-goto waiter
  //   could be installed);
  // - a matching GET already in flight from previous page state cannot
  //   satisfy the wait: its "request" event fired before these listeners
  //   existed, so it never enters postNavRequests, and any late request
  //   from the old document is excluded by the `navigated` flag — the main
  //   frame's navigation commit ("framenavigated") strictly precedes any
  //   fetch made by the new document.
  let navigated = false;
  const postNavRequests = new Set<Request>();
  const onFrameNavigated = (frame: Frame) => {
    if (frame === page.mainFrame()) navigated = true;
  };
  const onRequest = (request: Request) => {
    if (navigated && request.method() === "GET" && request.url() === listUrl) {
      postNavRequests.add(request);
    }
  };
  page.on("framenavigated", onFrameNavigated);
  page.on("request", onRequest);
  const listLoaded = page.waitForResponse(
    (r) => postNavRequests.has(r.request()),
    { timeout: 60_000 },
  );
  try {
    await page.goto("/admin");
    const menuItem = page.locator(".admin-menu-item", { hasText: section });
    // First load after login can wait on Auth0 checkSession + the test API.
    await expect(menuItem).toBeVisible({ timeout: 60_000 });
    await menuItem.click();
    const response = await listLoaded;
    // Fail loudly when the list load fails: on a non-2xx the section
    // renders LoadError with zero rows, which deleteItemsMatching would
    // otherwise mistake for "nothing to delete" and pass silently.
    if (!response.ok()) {
      throw new Error(
        `Admin "${section}" list failed to load: ` +
          `GET ${listUrl} returned ${response.status()}`,
      );
    }
    await waitForIdle(page);
    // A load can still fail after a 2xx (e.g. a body read/parse error), in
    // which case the section renders LoadError instead of the list.
    await expect(page.locator(".load-error")).toHaveCount(0);
  } finally {
    page.off("framenavigated", onFrameNavigated);
    page.off("request", onRequest);
  }
}

/** The admin list rows (each content item) on the current admin section. */
export function adminListItems(page: Page): Locator {
  return page.locator(".admin-data-list-item");
}

/** The admin list row containing the given marker text. */
export function adminListItem(page: Page, marker: string): Locator {
  return page.locator(".admin-data-list-item", { hasText: marker });
}

/**
 * Assert that `marker` no longer appears on a public page after an admin
 * delete. The public pages read JSON published to the local S3, and right
 * after a delete the browser can still serve the previous JSON (heuristic
 * caching / propagation lag, seen as flaky "Expected: 0, Received: 1"
 * failures in CI) — so reload until the marker is gone rather than
 * asserting a single snapshot.
 */
export async function expectGoneFromPublicPage(
  page: Page,
  opts: {
    /** Public route to load, e.g. "/haiku". */
    path: string;
    /** Substring of the published JSON URL to await, e.g. "haiku.json". */
    json: string;
    marker: string;
    /** Optional selector that must render before the marker check. */
    readySelector?: string;
  },
) {
  // Bypass the browser HTTP cache while polling: MinIO's Last-Modified has
  // one-second granularity, so when a delete rewrites the JSON within the
  // same second as the previous write, revalidation returns 304 forever and
  // reloads alone keep re-serving the stale cached body. Registering a
  // route disables the cache for the matched request.
  await page.route(`**/${opts.json}*`, (route) => route.continue());
  try {
    await expect(async () => {
      const json = page.waitForResponse((r) => r.url().includes(opts.json));
      await page.goto(opts.path);
      const jsonResponse = await json;
      // A failed JSON fetch renders the fetch-error state with zero
      // markers on the page, which would make the marker check below pass
      // vacuously — fail this attempt instead (toPass retries, so a
      // transient blip can still recover) so a persistent failure is
      // reported as a load failure, not as "marker gone".
      expect(
        jsonResponse.ok(),
        `GET ${jsonResponse.url()} returned ${jsonResponse.status()}`,
      ).toBe(true);
      if (opts.readySelector) {
        await expect(page.locator(opts.readySelector).first()).toBeVisible();
      }
      await expect(page.getByText(opts.marker)).toHaveCount(0, {
        timeout: 2_000,
      });
    }).toPass({ timeout: 90_000, intervals: [1_000, 2_000, 5_000] });
  } finally {
    await page.unroute(`**/${opts.json}*`);
  }
}

/**
 * Delete every admin list row containing `marker` in `section`. Used by
 * afterEach cleanup so failed tests still leave the shared test bucket the
 * way they found it.
 */
export async function deleteItemsMatching(
  page: Page,
  section: AdminSection,
  marker: string,
) {
  await openAdminSection(page, section);
  const rows = adminListItem(page, marker);
  // Bounded loop: never spins forever if deletion stops making progress.
  for (let i = 0; i < 10; i++) {
    const count = await rows.count();
    if (count === 0) break;
    await iconButton(rows.first(), "trash").click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 120_000);
    await expect(rows).toHaveCount(count - 1, { timeout: 60_000 });
  }
  await expect(rows).toHaveCount(0);
}
