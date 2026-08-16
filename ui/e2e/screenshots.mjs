// Captures full-page screenshots of the public pages for visual review —
// the "look at it" check that behavioral tests can't do (overflowing
// images, text blending into the background, broken mobile layouts).
//
// Two consumers, one script:
//   - Dev loop (see CLAUDE.md "Visual checks"): with the dev stack running
//     (`./scripts/dev.sh`), run `node e2e/screenshots.mjs` and inspect the
//     PNGs written to e2e/screenshots/.
//   - CI (.github/workflows/visual-review.yml): runs it against the
//     test-mode preview and has Claude review the PNGs on each UI PR.
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

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(E2E_DIR, "screenshots");

/** The public routes; admin pages need Auth0 and are not captured (yet). */
const DEFAULT_ROUTES = ["/", "/haiku", "/haiga", "/other-works", "/photography"];

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

const routes = (argValue("--routes")?.split(",") ?? DEFAULT_ROUTES).map(
  (route) => (route.startsWith("/") ? route : `/${route}`),
);

/** @param {string} route */
function slug(route) {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "-");
}

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

async function main() {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      for (const route of routes) {
        const file = path.join(OUTPUT_DIR, `${slug(route)}.${viewport.name}.png`);
        try {
          await page.goto(`${baseUrl}${route}`, {
            waitUntil: "networkidle",
            timeout: 60_000,
          });
          await waitForImages(page);
          // Let entrance animations (.fade-in) finish so text isn't captured
          // mid-transition at partial opacity.
          await page
            .evaluate(() =>
              Promise.all(
                document.getAnimations().map((a) => a.finished),
              ),
            )
            .catch(() => {});
          await page.screenshot({ path: file, fullPage: true });
          console.log(`captured ${path.relative(process.cwd(), file)}`);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failures.push(`${route} (${viewport.name}): ${message}`);
        }
      }
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
