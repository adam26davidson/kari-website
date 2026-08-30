import { test, expect, type Page } from "@playwright/test";
import { TEST_S3_URL } from "./helpers";

// Visitor journeys: the public pages render the fixture content seeded into
// the local S3 by e2e/seed.mjs. Assertions are deliberately loose — "at
// least one item renders" — so seeds can evolve without breaking specs.
//
// Note: the public list of blog posts is the "Other works" page; each
// post's title links to its own page at /blog/:id.

test("home page renders the photo and a non-empty blurb", async ({ page }) => {
  await page.goto("/");
  const photo = page.locator(`img[src^="${TEST_S3_URL}/images/"]`);
  await expect(photo).toBeVisible();
  // The photo actually loaded (not a broken image).
  await expect
    .poll(
      () =>
        photo.evaluate((img: HTMLImageElement) => img.naturalWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  // The blurb is the last fade-in block next to the photo.
  const blurb = page.locator(".fade-in").last();
  await expect(blurb).toBeVisible();
  expect((await blurb.innerText()).trim().length).toBeGreaterThan(0);
});

// The seeded home photo is landscape at real-photo dimensions (see
// seed.mjs), so these catch the photo overflowing the card layout — a
// regression that a 1x1 seed image can never trigger. Horizontal-only
// checks: the photo must sit inside its container and the container
// inside the card, at both desktop and mobile widths.
async function expectHomePhotoContained(page: Page) {
  await page.goto("/");
  const photo = page.locator(".home-page-photo");
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  const photoBox = await photo.boundingBox();
  const containerBox = await page
    .locator(".home-page-photo-container")
    .boundingBox();
  const cardBox = await page.locator(".home-page-card").boundingBox();
  if (!photoBox || !containerBox || !cardBox)
    throw new Error("home page card elements not rendered");
  expect(photoBox.x).toBeGreaterThanOrEqual(containerBox.x - 1);
  expect(photoBox.x + photoBox.width).toBeLessThanOrEqual(
    containerBox.x + containerBox.width + 1,
  );
  expect(containerBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
  expect(containerBox.x + containerBox.width).toBeLessThanOrEqual(
    cardBox.x + cardBox.width + 1,
  );
}

test("home page photo stays inside its card (desktop)", async ({ page }) => {
  await expectHomePhotoContained(page);
});

test("home page photo stays inside its card (mobile)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expectHomePhotoContained(page);
});

test("haiku page renders at least one seeded haiku", async ({ page }) => {
  await page.goto("/haiku");
  const lines = page.locator(".haiku-list-line");
  await expect(lines.first()).toBeVisible();
  expect((await lines.first().innerText()).trim().length).toBeGreaterThan(0);
});

test("haiga page renders at least one seeded haiga image", async ({
  page,
}) => {
  await page.goto("/haiga");
  const image = page.locator(".haiga-list-item-image").first();
  await expect(image).toBeVisible();
  await expect
    .poll(
      () =>
        image.evaluate((img: HTMLImageElement) => img.naturalWidth),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
});

// The seeded haiga is portrait at real-artwork dimensions (900x1200, see
// seed.mjs). Sizing the artwork by a fixed height rather than by the card
// width shrank it to ~150px inside a card twice that wide at mobile
// (issue #309), so assert the artwork fills the card it sits in — while
// still staying inside it.
test("haiga artwork fills the width of its card (mobile)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/haiga");
  const image = page.locator(".haiga-list-item-image").first();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  const imageBox = await image.boundingBox();
  const contentBox = await page
    .locator(".data-list-item-content")
    .first()
    .boundingBox();
  if (!imageBox || !contentBox)
    throw new Error("haiga card elements not rendered");
  // Nearly the full content width, not a fraction of it.
  expect(imageBox.width).toBeGreaterThanOrEqual(contentBox.width * 0.9);
  // ...and no wider than the card content box.
  expect(imageBox.width).toBeLessThanOrEqual(contentBox.width + 1);
});

test("other works (blog) page renders at least one published post", async ({
  page,
}) => {
  await page.goto("/other-works");
  const post = page.locator(".blog-post-summary").first();
  await expect(post).toBeVisible();
  const title = post.locator("a.title-link");
  await expect(title).toBeVisible();
  expect((await title.innerText()).trim().length).toBeGreaterThan(0);
});

test("clicking a post on the other works page opens its /blog/:id page", async ({
  page,
}) => {
  await page.goto("/other-works");
  const title = page.locator(".blog-post-summary a.title-link").first();
  await expect(title).toBeVisible();
  const titleText = (await title.innerText()).trim();
  await title.click();
  await expect(page).toHaveURL(/\/blog\/.+/);
  const post = page.locator(".other-works-item").first();
  await expect(post.locator("h1")).toHaveText(titleText);
  const content = post.locator(".other-works-item-content");
  await expect(content).toBeVisible();
  expect((await content.innerText()).trim().length).toBeGreaterThan(0);
});

test("photography page renders at least one seeded post", async ({ page }) => {
  await page.goto("/photography");
  const header = page.locator(".photography-post-header").first();
  await expect(header).toBeVisible();
  expect((await header.innerText()).trim().length).toBeGreaterThan(0);
  await expect(page.locator(".photography-post-image").first()).toBeVisible();
});

// The header used to be scrollable off the top of a phone screen (#558):
// the shell was `height: 100vh`, taller than the visible viewport while the
// browser chrome is shown, so the document scrolled as well as the app's
// own inner content area — and once the header was gone the inner scroller
// kept every further gesture, stranding it there.
//
// Honest scope: headless Chromium has no retracting URL bar, so `dvh` and
// `vh` are equal here and this cannot exercise the unit change itself
// (src/test/viewport-shell.test.ts pins that). What it does cover is the
// other half of the fix, which is what actually strands the header: the
// document must never be a scroll container, and wheeling over the content
// must move the content and leave the header where it is.
test("mobile: content scrolls under the header, never the document", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/haiku");
  await expect(page.locator(".haiku-list-line").first()).toBeVisible();

  const header = page.locator(".header");
  const headerBefore = await header.boundingBox();
  if (!headerBefore) throw new Error("header not rendered");
  expect(headerBefore.y).toBeLessThanOrEqual(1);

  // The document itself has nothing to scroll: the shell fits the viewport.
  const documentOverflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollHeight - root.clientHeight;
  });
  expect(documentOverflow).toBeLessThanOrEqual(1);

  // A long gesture over the middle of the content area, well past the end
  // of a short list, so nothing can absorb it quietly.
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(200);

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const headerAfter = await header.boundingBox();
  if (!headerAfter) throw new Error("header left the layout after scrolling");
  expect(headerAfter.y).toBeLessThanOrEqual(1);
});

// The site-wide keyboard focus ring (#501). jsdom cannot decide
// :focus-visible, so the unit tests can only pin the declared colours and
// widths; whether a real browser actually applies the rule to whatever the
// first tab stop happens to be is only answerable here. Deliberately loose
// about WHICH element that is — the assertion is that keyboard focus is
// never left with the bare UA outline.
test("keyboard focus draws the site's two-layer ring", async ({ page }) => {
  await page.goto("/");
  await page.locator(".header").waitFor();
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) return null;
    const style = getComputedStyle(focused);
    return {
      tag: focused.tagName,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    };
  });
  expect(ring, "nothing took focus on the first Tab").not.toBeNull();
  expect(ring?.outlineStyle).toBe("solid");
  expect(ring?.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(ring?.boxShadow).not.toBe("none");
});
