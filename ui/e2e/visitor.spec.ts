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

// The hairline between the photo and the blurb, which is a 1px border on a
// zero-WIDTH box: no width assertion can see it, the horizontal-overflow
// check cannot see it, and it contributes nothing to any layout it sits in.
// Its height is the only evidence it exists. It used to be `height: 90%`,
// and that percentage quietly resolved to `auto` — i.e. to no divider at
// all — the moment #581 stopped pinning `.home-page` to a definite height,
// which is the sort of thing only a rendered check catches.
test("home page draws the divider between the photo and the blurb", async ({
  page,
}) => {
  await page.goto("/");
  const card = page.locator(".home-page-card");
  await expect(card).toBeVisible();
  const cardBox = await card.boundingBox();
  const dividerBox = await page.locator(".home-page-divider").boundingBox();
  if (!cardBox || !dividerBox) throw new Error("home page card not rendered");
  // Most of the card's height, not a hairline's worth: the failure this
  // guards against collapses it to zero.
  expect(dividerBox.height).toBeGreaterThan(cardBox.height * 0.5);
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

// One scroll container below the header (#581). The shell used to stack
// four boxes that all declared `overflow-y: auto` and let the INNERMOST one
// do the scrolling; `.content` is now the only one on the public site and
// the page wrappers grow inside it.
//
// Consolidating those layers has a trap that only a real browser can see,
// and it is the reason this is tested here as well as in
// test/design/scroll-containers.test.ts. `.content` is a row flex container
// with the default `align-items: stretch`, so a wrapper whose height is
// auto gets clamped back to the shell's height. Its content then overflows
// a box that is centring it — `.content-page` is `justify-content:
// space-evenly` and `.home-page` is `center`, and BOTH fall back to centre
// alignment under negative free space — so the overflow splits across the
// top and bottom, and the top half sits above the scroller's origin where
// scrolling cannot reach it. The page looks fine on a tall screen and eats
// its own first line on a short one.
//
// So each of these runs on a viewport short enough that the page's own card
// cannot fit under the header, and then checks four things: the shell is
// what scrolls, the wrappers between it and the card are not scroll
// containers at all, and — the trap — the card's top is already visible at
// `scrollTop` 0 while its bottom is reachable from there.
async function expectShellIsTheOnlyScroller(
  page: Page,
  /** The page's content card, and the inert layers wrapping it. */
  { card, layers }: { card: string; layers: string[] },
) {
  const shell = page.locator(".content");
  const shellBox = await shell.boundingBox();
  const cardBox = await page.locator(card).first().boundingBox();
  if (!shellBox || !cardBox) throw new Error("the page did not render");

  // Precondition, phrased so it stays true whichever box is doing the
  // scrolling: there is more card than there is room for it. The seeded
  // lists are one item long, so without this a viewport that happens to fit
  // the whole page would pass everything below while proving nothing — and
  // measuring the SHELL's overflow here instead would make this fail with
  // "viewport too tall" on exactly the regression the test exists to catch.
  const room = await shell.evaluate((el) => el.clientHeight);
  expect(
    cardBox.height,
    "viewport is too tall to push the card past the shell",
  ).toBeGreaterThan(room);

  // So the shell is the box that turns that into a scrollbar.
  expect(
    await shell.evaluate((el) => el.scrollHeight - el.clientHeight),
    "the shell has no scrollable overflow — something inside it is scrolling",
  ).toBeGreaterThan(0);

  for (const selector of layers) {
    const layer = page.locator(selector).first();
    await expect(layer).toBeVisible();
    expect(
      await layer.evaluate((el) => getComputedStyle(el).overflowY),
      `${selector} is a scroll container`,
    ).toBe("visible");
  }

  // The trap: at rest, the card has not been centred off the top edge.
  expect(
    cardBox.y,
    "the top of the card is above the shell's scroll origin",
  ).toBeGreaterThanOrEqual(shellBox.y - 1);

  // ...and its far end is reachable from there.
  await shell.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const scrolled = await page.locator(card).first().boundingBox();
  if (!scrolled) throw new Error("the card left the layout after scrolling");
  expect(
    scrolled.y + scrolled.height,
    "the bottom of the card is unreachable by scrolling the shell",
  ).toBeLessThanOrEqual(shellBox.y + shellBox.height + 1);
}

test("list pages: the shell is the only thing that scrolls (mobile)", async ({
  page,
}) => {
  // Short enough that the single seeded haiga — portrait artwork at nearly
  // the full card width — cannot fit under the header.
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/haiga");
  const image = page.locator(".haiga-list-item-image").first();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expectShellIsTheOnlyScroller(page, {
    card: ".data-list",
    layers: [".content-page", ".data-list-container"],
  });
});

test("home page: the shell is the only thing that scrolls (desktop)", async ({
  page,
}) => {
  // Desktop width on purpose: `.home-page.mobile` switches to
  // `justify-content: flex-start`, so the centring fallback this guards
  // against is only reachable at >= 768px. Short enough that the card,
  // whose photo is capped at 400px tall, cannot fit.
  await page.setViewportSize({ width: 1000, height: 420 });
  await page.goto("/");
  const photo = page.locator(".home-page-photo");
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await expectShellIsTheOnlyScroller(page, {
    card: ".home-page-card",
    layers: [".home-page"],
  });
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
