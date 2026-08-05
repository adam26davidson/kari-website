import { test, expect } from "@playwright/test";
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

test("other works (blog) page renders at least one published post", async ({
  page,
}) => {
  await page.goto("/other-works");
  const post = page.locator(".other-works-item").first();
  await expect(post).toBeVisible();
  const title = post.locator("h1");
  await expect(title).toBeVisible();
  expect((await title.innerText()).trim().length).toBeGreaterThan(0);
});

test("clicking a post on the other works page opens its /blog/:id page", async ({
  page,
}) => {
  await page.goto("/other-works");
  const title = page.locator(".other-works-item h1 a").first();
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
