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
// Each route is captured at desktop (1280px), tablet (834px), and mobile
// (390px) widths. Animations are disabled and images awaited, so captures
// are stable.
//
// Horizontal overflow — the page being wider than the viewport — is also
// asserted programmatically at every captured width, plus a few extra
// assert-only widths (no PNGs) chosen to sweep the tablet danger band.
// The check runs at the real device size, BEFORE the viewport growth
// described below, and a failure names the route, the width, and the
// widest offending element. Any overflow makes the script exit non-zero
// (after all captures are written).
//
// The app is a fixed-viewport layout (`.whole-page` is 100vh) whose content
// scrolls inside inner containers, so Playwright's `fullPage: true` alone
// would only capture the first viewport-height of every page. Before each
// capture the viewport is therefore grown until no scroll container still
// overflows, which pulls all below-fold content (long haiku/haiga lists,
// photography captions, admin lists) into view.
//
// A single tall PNG would defeat the purpose, though: image review (Claude
// reading the PNG, in the dev loop and in CI) downscales to ~1.15 megapixels,
// so a 10000px-tall capture arrives a couple hundred px wide and illegible.
// Tall pages are therefore sliced into sequential full-resolution tiles
// (<name>.<viewport>.1.png, .2.png, …) with a small overlap so nothing is
// lost on a cut line; pages that fit in one tile keep the plain
// <name>.<viewport>.png filename.
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
  { route: "/admin/background", name: "admin-background" },
  { route: "/admin/image-cleanup", name: "admin-image-cleanup" },
];

const DEFAULT_ROUTES = [...PUBLIC_ROUTES, ...ADMIN_ROUTES];

/**
 * @typedef {{ name: string, width: number, height: number,
 *   assertOnly?: boolean }} Viewport
 *   `assertOnly` viewports run the horizontal-overflow assertion but write
 *   no PNGs — cheap sweeps of widths between the captured device sizes.
 */

/** @type {Viewport[]} */
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 834, height: 1112 }, // iPad Air portrait
  { name: "mobile", width: 390, height: 844 },
  // Assert-only sweep of the 768–948px band where the header once
  // overflowed (#221) — neither 1280 nor 390 could see it.
  { name: "assert-768", width: 768, height: 1024, assertOnly: true },
  { name: "assert-850", width: 850, height: 1024, assertOnly: true },
  { name: "assert-950", width: 950, height: 1024, assertOnly: true },
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
 * Waits for entrance animations (.fade-in) to finish so text isn't captured
 * mid-transition at partial opacity.
 *
 * @param {import("@playwright/test").Page} page
 */
async function waitForAnimations(page) {
  await page
    .evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished)),
    )
    .catch(() => {});
}

/**
 * Slack allowed before horizontal overflow counts as a failure, in px —
 * subpixel layout rounding can leave scrollWidth a hair past innerWidth
 * on perfectly healthy pages.
 */
const OVERFLOW_TOLERANCE = 2;

/**
 * Checks the page for horizontal overflow at the CURRENT viewport size.
 * Must run before expandViewportToContent — the assertion is about the
 * layout a visitor actually sees at the device size, not the grown
 * capture viewport.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string | null>} a human-readable description of the
 *   overflow (widest element included), or null when the page fits
 */
async function checkHorizontalOverflow(page) {
  return page.evaluate((tolerance) => {
    const viewportWidth = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth <= viewportWidth + tolerance) return null;
    // Name the culprit: the element whose rect reaches furthest past the
    // right edge of the viewport.
    /** @type {Element | null} */
    let widest = null;
    let widestRight = viewportWidth;
    for (const el of document.querySelectorAll("*")) {
      const { right } = el.getBoundingClientRect();
      if (right > widestRight) {
        widestRight = right;
        widest = el;
      }
    }
    /** @param {Element | null} el */
    const describe = (el) => {
      if (!el) return "no single element found past the viewport edge";
      const id = el.id ? `#${el.id}` : "";
      const classes =
        typeof el.className === "string" && el.className.trim() !== ""
          ? `.${el.className.trim().split(/\s+/).join(".")}`
          : "";
      return `<${el.tagName.toLowerCase()}${id}${classes}>`;
    };
    return (
      `page is ${scrollWidth}px wide in a ${viewportWidth}px viewport; ` +
      `widest element ${describe(widest)} extends to ` +
      `${Math.round(widestRight)}px`
    );
  }, OVERFLOW_TOLERANCE);
}

/**
 * Ceiling on the grown capture height — keeps a runaway page from producing
 * an absurd viewport or PNG, and stays under Chromium's ~16384px screenshot
 * texture limit. A warning is printed when a page is truncated by this cap.
 */
const MAX_CAPTURE_HEIGHT = 12_000;

/**
 * Grows the viewport height until no scroll container overflows, so the
 * subsequent screenshot includes below-fold content that lives inside the
 * app's inner scrolling areas. Runs a few passes because scrollers can nest
 * (admin lists inside the content area); stops early when nothing overflows
 * or when growing stops helping (a fixed-height scroller like a textarea
 * can never be resolved by a taller window).
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} viewport
 * @returns {Promise<{ height: number, hidden: number }>} the final viewport
 *   height and the px of content still hidden when capped (0 when
 *   everything fits)
 */
async function expandViewportToContent(page, viewport) {
  let height = viewport.height;
  let previousOverflow = Infinity;
  for (let pass = 0; pass < 5; pass++) {
    /** Tallest unscrolled remainder among all scroll containers, in px. */
    const overflow = await page.evaluate(() => {
      let max = 0;
      for (const el of document.querySelectorAll("*")) {
        const hidden = el.scrollHeight - el.clientHeight;
        if (hidden <= 1) continue; // <=1px is just rounding, not content
        const { overflowY } = getComputedStyle(el);
        if (overflowY !== "auto" && overflowY !== "scroll") continue;
        max = Math.max(max, hidden);
      }
      return max;
    });
    if (overflow <= 1 || overflow >= previousOverflow) break;
    if (height >= MAX_CAPTURE_HEIGHT) return { height, hidden: overflow };
    previousOverflow = overflow;
    height = Math.min(height + overflow, MAX_CAPTURE_HEIGHT);
    await page.setViewportSize({ width: viewport.width, height });
  }
  return { height, hidden: 0 };
}

/**
 * Max height of a single PNG. Review happens by Claude reading the images,
 * and vision input is downscaled to ~1.15 megapixels — a taller PNG would
 * arrive shrunk past legibility. Pages that grew beyond this are sliced
 * into tiles of this height instead.
 */
const TILE_HEIGHT = 2000;

/** Overlap between consecutive tiles, so a defect can't hide on a cut. */
const TILE_OVERLAP = 100;

/**
 * Captures the current page (already grown to `height` px) as one PNG when
 * it fits in a single tile, or as sequential overlapping tiles otherwise.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} viewport the base viewport
 * @param {number} height the grown viewport height
 * @param {string} stem output path without the .png / .N.png suffix
 * @returns {Promise<string[]>} the files written
 */
async function captureTiles(page, viewport, height, stem) {
  if (height <= TILE_HEIGHT) {
    const file = `${stem}.png`;
    await page.screenshot({ path: file, fullPage: true });
    return [file];
  }
  /** @type {number[]} */
  const offsets = [];
  for (let y = 0; ; y += TILE_HEIGHT - TILE_OVERLAP) {
    offsets.push(Math.min(y, height - TILE_HEIGHT));
    if (y + TILE_HEIGHT >= height) break;
  }
  /** @type {string[]} */
  const files = [];
  for (const [index, y] of offsets.entries()) {
    const file = `${stem}.${index + 1}.png`;
    await page.screenshot({
      path: file,
      clip: { x: 0, y, width: viewport.width, height: TILE_HEIGHT },
    });
    files.push(file);
  }
  return files;
}

/**
 * Captures every route at every viewport on the given page, resizing the
 * viewport between routes (one page per context keeps the session — and for
 * admin, the login — intact across viewports).
 *
 * @param {import("@playwright/test").Page} page
 * @param {RouteEntry[]} entries
 * @param {string[]} failures
 * @param {string[]} overflows horizontal-overflow findings, appended to
 */
async function captureRoutes(page, entries, failures, overflows) {
  for (const viewport of VIEWPORTS) {
    for (const entry of entries) {
      const stem = path.join(OUTPUT_DIR, `${entry.name}.${viewport.name}`);
      try {
        // Start at the real device size so the page lays out exactly as a
        // visitor first sees it, then grow the viewport for the capture.
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await page.goto(`${baseUrl}${entry.route}`, {
          waitUntil: "networkidle",
          timeout: 60_000,
        });
        await waitForImages(page);
        await waitForAnimations(page);
        // Assert no horizontal overflow while still at the device size —
        // growing the viewport below changes the layout under test.
        const overflow = await checkHorizontalOverflow(page);
        if (overflow) {
          overflows.push(
            `${entry.route} at ${viewport.width}px (${viewport.name}): ` +
              overflow,
          );
          console.error(
            `  OVERFLOW ${entry.route} at ${viewport.width}px ` +
              `(${viewport.name}): ${overflow}`,
          );
        }
        if (viewport.assertOnly) {
          if (!overflow) {
            console.log(
              `checked ${entry.route} at ${viewport.width}px — no overflow`,
            );
          }
          continue;
        }
        const { height, hidden } = await expandViewportToContent(
          page,
          viewport,
        );
        // Growing the viewport can reveal images that only start loading
        // once visible, and can retrigger transitions — settle both again.
        await waitForImages(page);
        await waitForAnimations(page);
        const files = await captureTiles(page, viewport, height, stem);
        for (const file of files) {
          console.log(`captured ${path.relative(process.cwd(), file)}`);
        }
        if (hidden > 0) {
          console.warn(
            `  warning: ${entry.route} (${viewport.name}) is taller than ` +
              `the ${MAX_CAPTURE_HEIGHT}px capture cap — the last ` +
              `~${hidden}px of content are not in the screenshots`,
          );
        }
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
  /** @type {string[]} */
  const overflows = [];
  try {
    if (publicEntries.length > 0) {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await captureRoutes(page, publicEntries, failures, overflows);
      await context.close();
    }
    if (adminEntries.length > 0 && username && password) {
      // A separate context so the public pages are captured exactly as a
      // visitor sees them, never with logged-in admin state.
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await loginAsAdmin(page, { baseUrl, username, password });
      await captureRoutes(page, adminEntries, failures, overflows);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\nFailed to capture ${failures.length} screenshot(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
  }
  if (overflows.length > 0) {
    console.error(
      `\nHorizontal overflow on ${overflows.length} route/width ` +
        "combination(s) — the page is wider than the viewport:",
    );
    for (const overflow of overflows) console.error(`  - ${overflow}`);
  }
  if (failures.length > 0 || overflows.length > 0) process.exit(1);
  console.log(
    `\nAll screenshots written to ${OUTPUT_DIR} (no horizontal overflow)`,
  );
}

await main();
