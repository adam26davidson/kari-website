import { test, expect, Page } from "@playwright/test";
import {
  adminListItem,
  confirmDialog,
  deleteButton,
  deleteItemsMatching,
  editButton,
  expectGoneFromPublicPage,
  openAdminSection,
  originalKey,
  pngFixturePath,
  TEST_S3_URL,
  uniqueMarker,
  waitForIdle,
} from "./helpers";
import {
  HomePageSnapshot,
  restoreHomePage,
  snapshotHomePage,
} from "./home-page-state";
import {
  SiteSettingsSnapshot,
  restoreSiteSettings,
  snapshotSiteSettings,
} from "./site-settings-state";

// Admin journeys: real create/edit/delete flows against the local e2e stack
// (the API on localhost:3000 backed by the seeded local MinIO),
// signed in by the test bundle's fake auth (#266) — no Auth0 credentials
// needed.
//
// These tests mutate shared state, so:
// - every created item carries a unique marker so parallel/retried runs
//   can't collide, and afterEach deletes anything the test left behind;
// - the whole file runs serially (fullyParallel: false on the admin
//   project) because list saves are whole-list PUTs.

const editorControls = (page: Page) =>
  page.locator(".data-editor-item-controls");

const saveButton = (page: Page) =>
  editorControls(page).getByRole("button", { name: "Save" });

async function saveEditor(page: Page) {
  const save = saveButton(page);
  await expect(save).toBeEnabled();
  await save.click();
}

async function closeEditor(page: Page) {
  await editorControls(page).getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".data-editor")).toBeHidden();
}

async function createNewItem(page: Page) {
  // Every list's add control is a labelled "Add a <thing>" button (#457).
  await page
    .getByRole("button", { name: /^Add a/ })
    .first()
    .click();
  await confirmDialog(page, "Yes");
  await waitForIdle(page, 120_000);
  await expect(page.locator(".data-editor")).toBeVisible({ timeout: 60_000 });
}

/**
 * The bottom edge of a selector's border box, in viewport coordinates.
 * Read straight from the DOM rather than via boundingBox() so it is
 * measured in the same layout pass as its sibling reads.
 */
async function boundingBottom(page: Page, selector: string): Promise<number> {
  return page.evaluate(
    (sel) => document.querySelector(sel)!.getBoundingClientRect().bottom,
    selector,
  );
}

async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator(".admin-toast")).toHaveText(text, {
    timeout: 120_000,
  });
}

test.describe("admin navigation", () => {
  let marker: string;
  test.beforeEach(() => {
    marker = uniqueMarker("nav");
  });

  test.afterEach(async ({ page }) => {
    await deleteItemsMatching(page, "Haiku", marker);
  });

  test("history walks sections and editors, guarding unsaved edits", async ({
    page,
  }) => {
    await openAdminSection(page, "Haiku");
    await expect(page).toHaveURL(/\/admin\/haiku$/);

    // Switching sections pushes history; back returns to the previous one.
    await page.locator(".admin-menu-item", { hasText: "Haiga" }).click();
    await expect(page).toHaveURL(/\/admin\/haiga$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/haiku$/);

    // Create a haiku to exercise the editor routes (cleaned up afterEach).
    await createNewItem(page);
    await expect(page).toHaveURL(/\/admin\/haiku\/[\w-]+$/);
    await page.locator(".data-editor textarea").fill(`${marker}\nline two`);
    await saveEditor(page);
    await expectToast(page, "Haiku saved");
    await closeEditor(page);
    await expect(page).toHaveURL(/\/admin\/haiku$/);

    // Opening an editor pushes history too, and its URL survives a reload.
    await editButton(adminListItem(page, marker)).click();
    await expect(page.locator(".data-editor")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/haiku\/[\w-]+$/);
    const editorUrl = page.url();
    await page.reload();
    await expect(page.locator(".data-editor")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator(".data-editor textarea")).toHaveValue(
      new RegExp(marker),
    );

    // Back from a clean editor returns to the list, no questions asked.
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/haiku$/);
    await expect(page.locator(".data-editor")).toBeHidden();

    // Back from a dirty editor asks first: No stays, Yes discards.
    await editButton(adminListItem(page, marker)).click();
    await expect(page.locator(".data-editor")).toBeVisible();
    await page.locator(".data-editor textarea").fill(`${marker}\nedited`);
    await page.goBack();
    await confirmDialog(page, "No");
    await expect(page.locator(".data-editor")).toBeVisible();
    await expect(page).toHaveURL(editorUrl);
    await page.goBack();
    await confirmDialog(page, "Yes");
    await expect(page).toHaveURL(/\/admin\/haiku$/);
    await expect(page.locator(".data-editor")).toBeHidden();
    // The discarded edit never reached the list.
    await expect(adminListItem(page, marker)).not.toContainText("edited");
  });
});

test.describe("haiku", () => {
  // A fresh marker per test AND per retry attempt: with a shared marker, a
  // row left by an earlier test/attempt matches this attempt's locators and
  // trips strict mode (seen once in CI as a flaky duplicate-row failure).
  let marker: string;
  test.beforeEach(() => {
    marker = uniqueMarker("haiku");
  });

  test.afterEach(async ({ page }) => {
    await deleteItemsMatching(page, "Haiku", marker);
  });

  test("create, edit, verify on public page, and delete a haiku", async ({
    page,
  }) => {
    await openAdminSection(page, "Haiku");

    // Create
    await createNewItem(page);
    await page
      .locator(".data-editor textarea")
      .fill(`${marker}\nsecond line\nthird line`);
    await page.getByLabel("Publisher").fill("e2e publisher");
    await saveEditor(page);
    await expectToast(page, "Haiku saved");
    await closeEditor(page);
    const row = adminListItem(page, marker);
    await expect(row).toBeVisible();

    // Edit
    await editButton(row).click();
    const textarea = page.locator(".data-editor textarea");
    await expect(textarea).toHaveValue(new RegExp(marker));
    await textarea.fill(`${marker}\nedited line`);
    await saveEditor(page);
    await expectToast(page, "Haiku saved");
    await closeEditor(page);
    await expect(adminListItem(page, marker)).toContainText("edited line");

    // Verify on the public page (published straight to the test bucket)
    await page.goto("/haiku");
    await expect(
      page.locator(".haiku-list-line", { hasText: marker }),
    ).toBeVisible();

    // Delete
    await openAdminSection(page, "Haiku");
    await deleteButton(adminListItem(page, marker)).click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 120_000);
    await expect(adminListItem(page, marker)).toHaveCount(0);

    // Gone from the public page too
    await expectGoneFromPublicPage(page, {
      path: "/haiku",
      json: "haiku.json",
      marker,
      readySelector: ".haiku-list-line",
    });
  });
});

test.describe("haiga", () => {
  // A haiga's haiku lines live inside the artwork, so the editor has no
  // text input for them — the marker goes in the Publisher field, which the
  // admin list and the public page both render, making rows identifiable
  // and cleanable by marker.
  let marker: string;
  test.beforeEach(() => {
    marker = uniqueMarker("haiga");
  });

  test.afterEach(async ({ page }) => {
    await deleteItemsMatching(page, "Haiga", marker);
  });

  test("create, edit, verify on public page, and delete a haiga", async ({
    page,
  }) => {
    await openAdminSection(page, "Haiga");

    // Create (persists an empty haiga to the list, then opens the editor).
    // Saving is disabled until an image is picked — the image is the
    // content of a haiga.
    await createNewItem(page);
    await expect(saveButton(page)).toBeDisabled();
    await page.getByLabel("Publisher").fill(marker);
    await page
      .locator('.data-editor input[type="file"]')
      .setInputFiles(pngFixturePath());
    // The chosen image shows up in the photo picker as a preview.
    await expect(page.locator(".photo-picker-image")).toBeVisible();
    await saveEditor(page);
    await expectToast(page, "Haiga saved");
    await closeEditor(page);
    const row = adminListItem(page, marker);
    await expect(row).toBeVisible();

    // Edit: the publisher and the uploaded image persisted (the image is
    // served through the API on the admin side).
    await editButton(row).click();
    const publisher = page.getByLabel("Publisher");
    await expect(publisher).toHaveValue(marker);
    await expect(
      page.locator('.photo-picker-image[src*="/images/"]'),
    ).toBeVisible();
    await publisher.fill(`${marker} edited`);
    await saveEditor(page);
    await expectToast(page, "Haiga saved");
    await closeEditor(page);
    await expect(adminListItem(page, marker)).toContainText(`${marker} edited`);

    // Verify on the public page: the haiga renders its S3-published image,
    // with no haiku lines displayed as text (they live in the image).
    await page.goto("/haiga");
    const publicItem = page.locator(".haiga-list-item-content", {
      hasText: marker,
    });
    await expect(publicItem).toBeVisible();
    const publicImage = publicItem.locator(".haiga-list-item-image");
    await expect(publicImage).toBeVisible();
    const imageSrc = await publicImage.getAttribute("src");
    expect(imageSrc).toContain(`${TEST_S3_URL}/images/`);
    expect((await page.request.get(imageSrc!)).status()).toBe(200);

    // Delete (the uploaded image object stays for the cleanup sweep)
    await openAdminSection(page, "Haiga");
    await deleteButton(adminListItem(page, marker)).click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 120_000);
    await expect(adminListItem(page, marker)).toHaveCount(0);

    // Gone from the public page too
    await expectGoneFromPublicPage(page, {
      path: "/haiga",
      json: "haiga.json",
      marker,
      readySelector: ".haiga-list-item-image",
    });
  });
});

test.describe("blog (other works)", () => {
  // Fresh per test and per retry attempt — both tests here create posts, so
  // a shared marker would make one test's row match the other's locators.
  let marker: string;
  test.beforeEach(() => {
    marker = uniqueMarker("blog");
  });

  test.afterEach(async ({ page }) => {
    await deleteItemsMatching(page, "Other works", marker);
  });

  test("draft posts do not appear on the public blog list", async ({
    page,
  }) => {
    await openAdminSection(page, "Other works");
    await createNewItem(page);
    await page.getByLabel("Title", { exact: true }).fill(marker);
    // Leave "Published" off: this is a draft. The control is a Radix
    // switch — a <button role="switch">, not a checkbox — so its state is
    // read from aria-checked rather than through toBeChecked().
    await expect(
      page.getByRole("switch", { name: "Published" }),
    ).toHaveAttribute("aria-checked", "false");
    await saveEditor(page);
    // The editor closes itself after a successful save.
    await expect(page.locator(".data-editor")).toBeHidden({
      timeout: 120_000,
    });
    await expect(adminListItem(page, marker)).toContainText("Draft");

    // Public blog list ("Other works" page) must not include the draft.
    const blogJson = page.waitForResponse((r) =>
      r.url().includes("blog-posts.json"),
    );
    await page.goto("/other-works");
    await blogJson;
    // The list rendered (the test bucket may have no published posts, so
    // assert the container rather than another post's item); our draft is
    // not in it.
    await expect(page.locator(".data-list")).toBeVisible();
    await expect(page.getByText(marker)).toHaveCount(0);

    // Cleanup happens in afterEach.
  });

  test("create a post with content and an image, publish it, and delete it", async ({
    page,
  }) => {
    await openAdminSection(page, "Other works");

    // Create a draft with rich-text content and an embedded image.
    await createNewItem(page);
    await page.getByLabel("Title", { exact: true }).fill(marker);
    const prose = page.locator(".tiptap-container .ProseMirror");
    await prose.click();
    await page.keyboard.type(`Body ${marker} content`);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add an image" }).click();
    await (await chooser).setFiles(pngFixturePath());
    // The image lands in the editor as an inline preview.
    await expect(prose.locator("img")).toBeVisible();
    await saveEditor(page);
    await expect(page.locator(".data-editor")).toBeHidden({
      timeout: 120_000,
    });
    await expect(adminListItem(page, marker)).toContainText("Draft");

    // Reopen: content and image persisted; draft images are served through
    // the API (private storage).
    await editButton(adminListItem(page, marker)).click();
    await expect(page.locator(".data-editor")).toBeVisible({
      timeout: 60_000,
    });
    await expect(prose).toContainText(`Body ${marker} content`);
    await expect(prose.locator('img[src*="/images/"]')).toHaveCount(1);

    // Edit the content and publish.
    await prose.locator("p", { hasText: marker }).first().click();
    await page.keyboard.type(" EDITED ");
    const published = page.getByRole("switch", { name: "Published" });
    await published.click();
    await expect(published).toHaveAttribute("aria-checked", "true");
    await saveEditor(page);
    await expect(page.locator(".data-editor")).toBeHidden({
      timeout: 180_000,
    });
    await expect(adminListItem(page, marker)).toContainText("Published");

    // Public list shows the post's summary; its /blog/:id permalink shows
    // the edited content and the image now published to S3.
    await page.goto("/other-works");
    const summary = page.locator(".blog-post-summary", { hasText: marker });
    await expect(summary).toBeVisible();
    await summary.locator("a.title-link").click();
    await expect(page).toHaveURL(/\/blog\/.+/);
    const publicPost = page.locator(".other-works-item", { hasText: marker });
    await expect(publicPost.locator("h1", { hasText: marker })).toBeVisible();
    await expect(publicPost).toContainText("EDITED");
    const publicImage = publicPost.locator(
      `img[src^="${TEST_S3_URL}/images/"]`,
    );
    await expect(publicImage).toHaveCount(1);
    const imageSrc = await publicImage.getAttribute("src");
    const imageResponse = await page.request.get(imageSrc!);
    expect(imageResponse.status()).toBe(200);

    // Delete (also removes the content document; image objects stay
    // for the cleanup sweep).
    await openAdminSection(page, "Other works");
    await deleteButton(adminListItem(page, marker)).click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 180_000);
    await expect(adminListItem(page, marker)).toHaveCount(0);

    // Gone from the public list.
    await expectGoneFromPublicPage(page, {
      path: "/other-works",
      json: "blog-posts.json",
      marker,
      readySelector: ".data-list",
    });
  });
});

test.describe("photography", () => {
  let marker: string;
  test.beforeEach(() => {
    marker = uniqueMarker("photo");
  });

  test.afterEach(async ({ page }) => {
    await deleteItemsMatching(page, "Photography", marker);
  });

  test("create a post with an uploaded image, edit it, and delete it", async ({
    page,
  }) => {
    await openAdminSection(page, "Photography");

    // Create
    await createNewItem(page);
    await page.getByLabel("Title", { exact: true }).fill(marker);
    await page.getByLabel("Subtitle").fill("e2e subtitle");
    await page.getByLabel("Blurb (optional)").fill("e2e blurb");

    // Add an image: new picker slot, then pick the PNG fixture.
    const imagesSection = page.locator(".photography-post-editor-images");
    await imagesSection.getByRole("button", { name: "Add an image" }).click();
    await imagesSection
      .locator('input[type="file"]')
      .setInputFiles(pngFixturePath());
    // The chosen image shows up in the photo picker as a preview.
    await expect(imagesSection.locator(".photo-picker-image")).toBeVisible();
    await page.getByLabel("Caption (optional)").fill("e2e caption");

    await saveEditor(page);
    await expect(page.locator(".data-editor")).toBeHidden({
      timeout: 180_000,
    });
    const row = adminListItem(page, marker);
    await expect(row).toBeVisible();

    // The uploaded image appears in the admin summary (served via the API).
    const summaryImage = row.locator(".photography-post-summary-image");
    await expect(summaryImage).toHaveCount(1);
    const summarySrc = await summaryImage.getAttribute("src");
    expect((await page.request.get(summarySrc!)).status()).toBe(200);

    // Reopen: the persisted image renders in the photo picker.
    await editButton(row).click();
    await expect(
      imagesSection.locator('.photo-picker-image[src*="/images/"]'),
    ).toBeVisible();
    // Edit the subtitle and save.
    await page.getByLabel("Subtitle").fill("e2e subtitle edited");
    await saveEditor(page);
    await expect(page.locator(".data-editor")).toBeHidden({
      timeout: 180_000,
    });

    // Public page: title, caption, and the S3-published image render.
    await page.goto("/photography");
    const publicPost = page.locator(".photography-post-content", {
      hasText: marker,
    });
    await expect(
      publicPost.locator(".photography-post-header", { hasText: marker }),
    ).toBeVisible();
    await expect(publicPost).toContainText("e2e subtitle edited");
    await expect(publicPost).toContainText("e2e caption");
    const publicImage = publicPost.locator(
      `img[src^="${TEST_S3_URL}/images/"]`,
    );
    await expect(publicImage).toHaveCount(1);
    const publicSrc = await publicImage.getAttribute("src");
    expect((await page.request.get(publicSrc!)).status()).toBe(200);

    // Delete (the uploaded image objects stay for the cleanup sweep).
    await openAdminSection(page, "Photography");
    await deleteButton(adminListItem(page, marker)).click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 180_000);
    await expect(adminListItem(page, marker)).toHaveCount(0);

    // Gone from the public page.
    await expectGoneFromPublicPage(page, {
      path: "/photography",
      json: "photography",
      marker,
    });
  });

  // Layout, not behaviour, and the only level that can see it: jsdom lays
  // nothing out and the screenshot harness cannot detect this class of
  // overflow (#741). The editor card used to be clamped to the viewport
  // (`.data-editor-content { max-height: calc(100% - 40px) }`) with no
  // overflow-y anywhere in the clamped chain, so on a post with several
  // images the fields resolved PAST the card's bottom rim — the 24px of
  // padding below the last field was eaten and the panel read as cut off
  // rather than deliberately closed (#578, design brief §1). The card now
  // grows with its content and .admin-content is the single scroller.
  test("the editor card contains its content when a post has several images", async ({
    page,
  }) => {
    await openAdminSection(page, "Photography");

    // Create and save an empty post so afterEach can find it by marker;
    // the layout work then happens on the reopened editor.
    await createNewItem(page);
    await page.getByLabel("Title", { exact: true }).fill(marker);
    await saveEditor(page);
    await expect(page.locator(".data-editor")).toBeHidden({
      timeout: 180_000,
    });
    await editButton(adminListItem(page, marker)).click();

    // Four image rows takes the editor past the 720px-tall desktop
    // viewport. No files are attached: the row's height is what makes the
    // editor tall, and an unsaved row costs no upload.
    const imagesSection = page.locator(".photography-post-editor-images");
    const addImage = imagesSection.getByRole("button", {
      name: "Add an image",
    });
    for (let i = 0; i < 4; i++) {
      await addImage.click();
    }
    const removeButtons = imagesSection.getByRole("button", {
      name: "Remove this image",
    });
    await expect(removeButtons).toHaveCount(4);

    const viewportHeight = page.viewportSize()!.height;
    const lastRemove = removeButtons.last();
    // Precondition: the editor really is taller than the window, so the
    // assertions below are about the overflowing case and not a short card
    // that would pass either way.
    const lastRemoveBox = (await lastRemove.boundingBox())!;
    expect(lastRemoveBox.y).toBeGreaterThan(viewportHeight);

    // Containment: the fields end inside the card, with the card's own
    // bottom padding intact below them. Before #578 they ran past the rim
    // instead. The card is the migrated editor's (#236) — `p-5 sm:p-8`, and
    // this viewport is well past `sm`, so 32px is what should be left below
    // the last field. `.data-editor-content` and `.data-list-item-inputs`
    // were the LEGACY editor's boxes and went with its stylesheet.
    const contentBottom = await boundingBottom(
      page,
      '.data-editor [data-slot="card"]',
    );
    const inputsBottom = await boundingBottom(
      page,
      ".photography-post-editor-images",
    );
    expect(inputsBottom).toBeLessThanOrEqual(contentBottom);
    expect(contentBottom - inputsBottom).toBeGreaterThanOrEqual(31);
    expect(contentBottom - inputsBottom).toBeLessThanOrEqual(33);

    // Reachability: scrolling the page brings the last row's control into
    // view (nothing is stranded below the fold).
    await lastRemove.scrollIntoViewIfNeeded();
    await expect(lastRemove).toBeInViewport();

    // Discard the unsaved rows.
    await editorControls(page).getByRole("button", { name: "Close" }).click();
    await confirmDialog(page, "Yes");
    await expect(page.locator(".data-editor")).toBeHidden();

    await deleteButton(adminListItem(page, marker)).click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 180_000);
    await expect(adminListItem(page, marker)).toHaveCount(0);
  });
});

test.describe("home page", () => {
  // The home page is a single shared document (home-page.json + one photo),
  // not an append-only list — saving overwrites the shared document, so
  // nothing done through the UI can undo a run. Instead the S3-visible
  // state is snapshotted before each attempt and restored in afterEach
  // (see e2e/home-page-state.ts), which runs even when the test fails
  // midway and does not depend on the page still being alive.
  let marker: string;
  let snapshot: HomePageSnapshot | undefined;

  test.beforeEach(async () => {
    marker = uniqueMarker("home");
    snapshot = await snapshotHomePage();
  });

  test.afterEach(async () => {
    if (!snapshot) return;
    await restoreHomePage(snapshot);
    snapshot = undefined;
  });

  test("edit the blurb and photo, verify on the public home page, and restore", async ({
    page,
  }) => {
    await openAdminSection(page, "Home");

    // The editor loads the current data through the admin API; wait for the
    // existing blurb so the save below can't race the initial fetch (saving
    // an empty editor would overwrite the real data).
    const blurb = page.locator(".home-page-editor textarea");
    await expect(blurb).toBeVisible({ timeout: 60_000 });
    await expect(blurb).not.toHaveValue("");

    // Edit the blurb and pick a replacement photo.
    await blurb.fill(`${marker} home blurb`);
    await page
      .locator('.photo-picker input[type="file"]')
      .setInputFiles(pngFixturePath());
    // The picked file previews in the photo picker.
    await expect(page.locator(".photo-picker-image")).toBeVisible();

    await page.locator(".admin-button", { hasText: "Save" }).click();
    await expectToast(page, "Home page saved");
    await waitForIdle(page, 120_000);

    // Public home page shows the new blurb and the newly uploaded photo.
    await page.goto("/");
    await expect(page.getByText(`${marker} home blurb`)).toBeVisible();
    const photo = page.locator(`img[src^="${TEST_S3_URL}/images/"]`);
    await expect(photo).toBeVisible();
    const src = await photo.getAttribute("src");
    // Saving uploads under a freshly minted filename — the public page must
    // now reference it, not the snapshot's photo.
    expect(src).not.toBe(`${TEST_S3_URL}/${originalKey(snapshot!.photo)}`);
    expect((await page.request.get(src!)).status()).toBe(200);

    // afterEach restores the snapshot (blurb, photo reference, and the
    // original image object) and verifies the restore — including when any
    // assertion above failed.
  });
});

test.describe("home page preview", () => {
  // The whole point of the in-editor preview (#239) is that she sees the
  // change BEFORE saving, so nothing here saves anything: no snapshot, no
  // restore, no upload. The editor is left dirty and the test ends; the
  // unsaved-changes guard only fires on an in-app navigation, and each test
  // gets a fresh page.
  const PREVIEW = 'iframe[title="Preview of your site"]';

  let marker: string;
  test.beforeEach(({ page }) => {
    marker = uniqueMarker("preview");
    // The editor is left with unsaved edits on purpose, so the browser's
    // own "leave site?" prompt would otherwise block teardown.
    page.on("dialog", (dialog) => dialog.accept());
  });

  /** Opens the home editor and waits for its real data to be in the form. */
  async function openHomeEditor(page: Page) {
    await openAdminSection(page, "Home");
    const blurb = page.locator(".home-page-editor textarea");
    await expect(blurb).toBeVisible({ timeout: 60_000 });
    await expect(blurb).not.toHaveValue("");
    return blurb;
  }

  test("shows the unsaved blurb and photo on the real home page", async ({
    page,
  }) => {
    const blurb = await openHomeEditor(page);
    const preview = page.frameLocator(PREVIEW);

    // The pane frames the real public home page, which renders the
    // deployed blurb until the editor sends anything.
    await expect(preview.locator(".home-page-blurb")).toBeVisible({
      timeout: 60_000,
    });

    await blurb.fill(`${marker} unsaved blurb`);
    await expect(preview.getByText(`${marker} unsaved blurb`)).toBeVisible();

    // A candidate photo travels as a File and renders from a blob: URL —
    // nothing has been uploaded at this point.
    await page
      .locator('.photo-picker input[type="file"]')
      .setInputFiles(pngFixturePath());
    await expect(preview.locator(".home-page-photo")).toHaveAttribute(
      "src",
      /^blob:/,
    );

    // Nothing was saved, so the LIVE page still shows the old text.
    await page.goto("/");
    await expect(page.getByText(`${marker} unsaved blurb`)).toHaveCount(0);
  });

  test("keeps the draft while she browses inside the pane", async ({
    page,
  }) => {
    const blurb = await openHomeEditor(page);
    const preview = page.frameLocator(PREVIEW);
    await blurb.fill(`${marker} unsaved blurb`);
    await expect(preview.getByText(`${marker} unsaved blurb`)).toBeVisible();

    // The pane is the real SPA: click through to another page and back.
    await preview.getByRole("link", { name: "Haiku" }).click();
    await expect(preview.getByRole("link", { name: "Home" })).toBeVisible();
    await preview.getByRole("link", { name: "Home" }).click();

    // The overrides live above the framed router, so they survived.
    await expect(preview.getByText(`${marker} unsaved blurb`)).toBeVisible();
  });

  test("shows the page at a phone's width when asked", async ({ page }) => {
    await openHomeEditor(page);
    const frame = page.locator(PREVIEW);
    await expect(frame).toBeVisible();

    const wide = (await frame.boundingBox())!.width;
    // The desktop frame is scaled down to fit the editor column rather than
    // rendered at the column's own width, which would be the phone layout.
    expect(wide).toBeGreaterThan(400);

    await page.getByRole("button", { name: "Phone" }).click();
    const narrow = (await frame.boundingBox())!.width;
    expect(narrow).toBeLessThanOrEqual(391);
    await expect(
      page.frameLocator(PREVIEW).locator(".home-page.mobile"),
    ).toBeVisible();
  });
});

test.describe("appearance", () => {
  // The Appearance page edits a single shared document (site-settings.json),
  // not an append-only list, so — like the home page — nothing done through
  // the UI can undo a run. e2e/seed.mjs writes no settings object at all, so
  // the state to restore is usually "there was none"; see
  // e2e/site-settings-state.ts, whose restore runs even when a test dies
  // midway and does not depend on the page still being alive.
  let snapshot: SiteSettingsSnapshot | undefined;

  // Colours the site uses nowhere else, so an assertion below can only pass
  // if THIS journey's save is what painted the header. All three differ from
  // the built-in colours (a near-black green bar, white title, white links).
  const BAR_COLOR = "#2f5d8a";
  const TITLE_COLOR = "#ffe08a";
  const NAV_COLOR = "#c8f0d0";

  /** `#rrggbb` as Chromium serializes an opaque computed colour. */
  const rgb = (hex: string) =>
    `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

  /** The Appearance page's single Save, under everything it saves. */
  const savePage = (page: Page) =>
    page.locator(".admin-button", { hasText: "Save" }).click();

  /** A per-row "Use default", exact so the background card's is not one. */
  const useDefaultButtons = (page: Page) =>
    page.getByRole("button", { name: "Use default", exact: true });

  /**
   * A rendered element's computed value for one property, as the browser
   * serializes it. Read through the real cascade rather than off the style
   * attribute: the whole point is that the custom property useSiteBackground
   * sets actually reaches the rule in header.css that consumes it.
   */
  const computedStyle = (page: Page, selector: string, property: string) =>
    page.evaluate(
      ([sel, prop]) => {
        const element = document.querySelector(sel);
        if (!element) throw new Error(`Nothing matched ${sel}`);
        return getComputedStyle(element).getPropertyValue(prop);
      },
      [selector, property],
    );

  /**
   * Load the public home page and wait for the settings fetch the header
   * colours ride in on, so the assertions that follow are made against an
   * applied settings object rather than the first paint.
   */
  async function openPublicHome(page: Page) {
    const settingsLoaded = page.waitForResponse((r) =>
      r.url().includes("site-settings.json"),
    );
    await page.goto("/");
    await settingsLoaded;
    await expect(page.locator(".header")).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    snapshot = await snapshotSiteSettings();
    // The public site reads site-settings.json straight from MinIO, whose
    // Last-Modified has one-second granularity: when two saves land in the
    // same second, revalidation returns 304 forever and reloads keep serving
    // the first body. Registering a route disables the HTTP cache for the
    // matched request (the same trick expectGoneFromPublicPage uses).
    await page.route("**/site-settings.json*", (route) => route.continue());
  });

  test.afterEach(async () => {
    if (!snapshot) return;
    await restoreSiteSettings(snapshot);
    snapshot = undefined;
  });

  test("pick a header colour, save, and find it there after a reload", async ({
    page,
  }) => {
    await openAdminSection(page, "Appearance");

    const barSwatch = page.locator("#header-bar-color");
    await expect(barSwatch).toBeVisible();
    await barSwatch.fill(BAR_COLOR);
    await expect(barSwatch).toHaveValue(BAR_COLOR);
    // A colour that is no longer the built-in one offers the way back.
    await expect(useDefaultButtons(page)).toHaveCount(1);

    // Only the colour group changed, so the acknowledgement names that group
    // rather than the whole page.
    await savePage(page);
    await expectToast(page, "Header colours saved");
    await waitForIdle(page, 120_000);

    // Reload rather than re-read the form: this is what proves the save
    // reached the settings object instead of only the React state.
    await page.reload();
    await expect(page.locator("#header-bar-color")).toHaveValue(BAR_COLOR, {
      timeout: 60_000,
    });
    await expect(useDefaultButtons(page)).toHaveCount(1);
  });

  test("header colours reach the public header, and Use default puts them back", async ({
    page,
  }) => {
    // The built-in appearance, measured rather than hard-coded: header.css
    // states the defaults as var() fallbacks (one of them a color-mix), and
    // this journey cares that clearing a setting gets the site BACK here,
    // not how Chromium spells it.
    await openPublicHome(page);
    const defaultBar = await computedStyle(page, ".header", "background-color");
    const defaultTitle = await computedStyle(page, ".header-title", "color");
    const defaultNav = await computedStyle(page, ".pages a", "color");

    await openAdminSection(page, "Appearance");
    // The captured baseline is only the default appearance if the site is
    // unconfigured, which a seeded stack is — say so loudly if it is not,
    // rather than comparing the end of this journey against leaked state.
    await expect(
      page.getByText("These are the site's built-in colours."),
    ).toBeVisible();

    await page.locator("#header-bar-color").fill(BAR_COLOR);
    await page.locator("#header-title-color").fill(TITLE_COLOR);
    await page.locator("#header-nav-color").fill(NAV_COLOR);

    // The bar is stored as `#rrggbbaa` — the chosen colour plus the
    // see-through slider's alpha — and the admin's preview bar carries that
    // composed value as an inline style. Taking the expected colour from
    // there keeps the alpha out of this test entirely, and makes the
    // assertion below "the visitor sees what the preview promised".
    const expectedBar = await computedStyle(
      page,
      ".header-colors-preview-bar",
      "background-color",
    );
    expect(expectedBar).not.toBe(defaultBar);

    await savePage(page);
    await expectToast(page, "Header colours saved");
    await waitForIdle(page, 120_000);

    // The whole point of the feature: the PUBLIC header repaints.
    await openPublicHome(page);
    await expect(page.locator(".header")).toHaveCSS(
      "background-color",
      expectedBar,
    );
    await expect(page.locator(".header-title")).toHaveCSS(
      "color",
      rgb(TITLE_COLOR),
    );
    await expect(page.locator(".pages a").first()).toHaveCSS(
      "color",
      rgb(NAV_COLOR),
    );

    // Now clear all three. Each row's reset disappears once that setting is
    // back to the built-in colour, so the count itself says how far this
    // got; the loop is bounded by the number of settings.
    await openAdminSection(page, "Appearance");
    const resets = useDefaultButtons(page);
    await expect(resets).toHaveCount(3);
    for (let remaining = 3; remaining > 0; remaining--) {
      await resets.first().click();
      await expect(resets).toHaveCount(remaining - 1);
    }
    await expect(
      page.getByText("These are the site's built-in colours."),
    ).toBeVisible();

    await savePage(page);
    await expectToast(page, "Header colours saved");
    await waitForIdle(page, 120_000);

    // Cleared settings are stored as "", which useSiteBackground declines to
    // publish — so the stylesheet's own fallbacks paint again.
    await openPublicHome(page);
    await expect(page.locator(".header")).toHaveCSS(
      "background-color",
      defaultBar,
    );
    await expect(page.locator(".header-title")).toHaveCSS(
      "color",
      defaultTitle,
    );
    await expect(page.locator(".pages a").first()).toHaveCSS(
      "color",
      defaultNav,
    );
  });
});
