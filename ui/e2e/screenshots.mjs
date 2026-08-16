// Captures full-page screenshots of the public and admin pages for visual
// review — the "look at it" check that behavioral tests can't do
// (overflowing images, text blending into the background, broken mobile
// layouts).
//
// Two consumers, one script:
//   - Dev loop (see CLAUDE.md "Visual checks"): with the dev stack running
//     (`./scripts/dev.sh`), run `node e2e/screenshots.mjs` and inspect the
//     PNGs written to e2e/screenshots/.
//   - CI (.github/workflows/visual-review.yml): runs it against the
//     test-mode preview and has Claude review the PNGs on each UI PR.
//
// Admin pages (lists, editors deep-linked to seeded fixture items, image
// cleanup) are captured through a real Auth0 login and therefore need
// E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD (the same credentials the admin
// e2e journeys use). Without them the script captures the public pages only
// and says so — it never fails just because credentials are absent, unless
// admin routes were requested explicitly via --routes.
//
// Usage:
//   node e2e/screenshots.mjs [--base-url http://localhost:5173] [--routes /,/haiku]
//   SCREENSHOT_BASE_URL also sets the base URL (flag wins).
//
// Each route is captured at desktop (1280px) and mobile (390px) widths.
// Animations are disabled and images awaited, so captures are stable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { loginAsAdmin } from "./auth0-login.mjs";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(E2E_DIR, "screenshots");

/**
 * @typedef {{ route: string, name: string }} RouteEntry
 *   `route` is the URL path; `name` is the screenshot filename stem.
 */

/** The public routes. @type {RouteEntry[]} */
const PUBLIC_ROUTES = ["/", "/haiku", "/haiga", "/other-works", "/photography"]
  .map((route) => ({ route, name: slug(route) }));

/**
 * The admin routes: every list page plus each editor, deep-linked to the
 * deterministic item seeded by e2e/seed.mjs so captures are stable
 * run-to-run. @type {RouteEntry[]}
 */
const ADMIN_ROUTES = [
  { route: "/admin/home", name: "admin-home-editor" },
  { route: "/admin/haiku", name: "admin-haiku-list" },
  { route: "/admin/haiku/seed-haiku-1", name: "admin-haiku-editor" },
  { route: "/admin/haiga", name: "admin-haiga-list" },
  { route: "/admin/haiga/seed-haiga-1", name: "admin-haiga-editor" },
  { route: "/admin/photography", name: "admin-photography-list" },
  {
    route: "/admin/photography/seed-photography-1",
    name: "admin-photography-editor",
  },
  { route: "/admin/other-works", name: "admin-other-works-list" },
  { route: "/admin/other-works/seed-blog-1", name: "admin-other-works-editor" },
  { route: "/admin/image-cleanup", name: "admin-image-cleanup" },
];

const DEFAULT_ROUTES = [...PUBLIC_ROUTES, ...ADMIN_ROUTES];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

/** @param {string} flag @returns {string | undefined} */
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const baseUrl = (
  argValue("--base-url") ??
  process.env.SCREENSHOT_BASE_URL ??
  "http://localhost:5173"
).replace(/\/$/, "");

/** @param {string} route */
function slug(route) {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "-");
}

/** @param {string} route @returns {RouteEntry} */
function toEntry(route) {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return (
    DEFAULT_ROUTES.find((entry) => entry.route === normalized) ?? {
      route: normalized,
      name: slug(normalized),
    }
  );
}

const explicitRoutes = argValue("--routes")?.split(",").map(toEntry);
const routes = explicitRoutes ?? DEFAULT_ROUTES;

/**
 * Waits until every <img> on the page has finished loading (or failed —
 * a broken image is itself worth seeing in the screenshot).
 *
 * @param {import("@playwright/test").Page} page
 */
async function waitForImages(page) {
  await page.waitForFunction(
    () =>
      Array.from(document.images).every(
        (img) => img.complete && (img.naturalWidth > 0 || !img.currentSrc),
      ),
    undefined,
    { timeout: 30_000 },
  );
}

/**
 * Captures every route at every viewport on the given page, resizing the
 * viewport between passes (one page per context keeps the session — and for
 * admin, the login — intact across viewports).
 *
 * @param {import("@playwright/test").Page} page
 * @param {RouteEntry[]} entries
 * @param {string[]} failures
 */
async function captureRoutes(page, entries, failures) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const entry of entries) {
      const file = path.join(OUTPUT_DIR, `${entry.name}.${viewport.name}.png`);
      try {
        await page.goto(`${baseUrl}${entry.route}`, {
          waitUntil: "networkidle",
          timeout: 60_000,
        });
        await waitForImages(page);
        // Let entrance animations (.fade-in) finish so text isn't captured
        // mid-transition at partial opacity.
        await page
          .evaluate(() =>
            Promise.all(document.getAnimations().map((a) => a.finished)),
          )
          .catch(() => {});
        await page.screenshot({ path: file, fullPage: true });
        console.log(`captured ${path.relative(process.cwd(), file)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${entry.route} (${viewport.name}): ${message}`);
      }
    }
  }
}

async function main() {
  const username = process.env.E2E_AUTH0_USERNAME;
  const password = process.env.E2E_AUTH0_PASSWORD;
  const hasAuthCredentials = Boolean(username && password);

  const publicEntries = routes.filter(
    (entry) => !entry.route.startsWith("/admin"),
  );
  let adminEntries = routes.filter((entry) =>
    entry.route.startsWith("/admin"),
  );

  if (adminEntries.length > 0 && !hasAuthCredentials) {
    if (explicitRoutes) {
      console.error(
        "Admin routes were requested via --routes but " +
          "E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD are not set.",
      );
      process.exit(1);
    }
    console.warn(
      "E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD not set — capturing the " +
        "public pages only and skipping the admin pages.",
    );
    adminEntries = [];
  }

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  /** @type {string[]} */
  const failures = [];
  try {
    if (publicEntries.length > 0) {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await captureRoutes(page, publicEntries, failures);
      await context.close();
    }
    if (adminEntries.length > 0 && username && password) {
      // A separate context so the public pages are captured exactly as a
      // visitor sees them, never with logged-in admin state.
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await loginAsAdmin(page, { baseUrl, username, password });
      await captureRoutes(page, adminEntries, failures);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\nFailed to capture ${failures.length} screenshot(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`\nAll screenshots written to ${OUTPUT_DIR}`);
}

await main();
