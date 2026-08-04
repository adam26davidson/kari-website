import { test, expect, Page } from "@playwright/test";
import {
  adminListItem,
  adminListItems,
  confirmDialog,
  deleteItemsMatching,
  iconButton,
  openAdminSection,
  pngFixturePath,
  TEST_S3_URL,
  uniqueMarker,
  waitForIdle,
} from "./helpers";

// Admin journeys: real create/edit/delete flows against the shared test
// environment (test API on Render + test S3 bucket), authenticated via the
// storageState captured in auth.setup.ts.
//
// These tests mutate shared state, so:
// - every created item carries a unique marker so parallel/retried runs
//   can't collide, and afterEach deletes anything the test left behind;
// - the whole file runs serially (fullyParallel: false on the admin
//   project) because list saves are whole-list PUTs.

const editorControls = (page: Page) =>
  page.locator(".data-editor-item-controls");

async function saveEditor(page: Page) {
  const save = iconButton(editorControls(page), "floppy-disk");
  await expect(save).not.toHaveClass(/disabled/);
  await save.click();
}

async function closeEditor(page: Page) {
  await iconButton(editorControls(page), "xmark").click();
  await expect(page.locator(".data-editor")).toBeHidden();
}

async function createNewItem(page: Page) {
  await iconButton(page, "plus").first().click();
  await confirmDialog(page, "Yes");
  await waitForIdle(page, 120_000);
  await expect(page.locator(".data-editor")).toBeVisible({ timeout: 60_000 });
}

async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator(".admin-toast")).toHaveText(text, {
    timeout: 120_000,
  });
}

test.describe("haiku", () => {
  const marker = uniqueMarker("haiku");

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
    await page.getByPlaceholder("Publisher").fill("e2e publisher");
    await saveEditor(page);
    await expectToast(page, "Haiku saved");
    await closeEditor(page);
    const row = adminListItem(page, marker);
    await expect(row).toBeVisible();

    // Edit
    await iconButton(row, "pencil").click();
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
    await iconButton(adminListItem(page, marker), "trash").click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 120_000);
    await expect(adminListItem(page, marker)).toHaveCount(0);

    // Gone from the public page too
    const haikuJson = page.waitForResponse((r) =>
      r.url().includes("haiku.json"),
    );
    await page.goto("/haiku");
    await haikuJson;
    await expect(page.locator(".haiku-list-line").first()).toBeVisible();
    await expect(page.getByText(marker)).toHaveCount(0);
  });
});

test.describe("haiga", () => {
  // A new haiga has no identifying text (the editor has no input for the
  // haiku lines, see below), so cleanup works by list count: anything this
  // test added beyond the initial count is removed from the end of the list
  // (new items are appended).
  test("create and delete a haiga", async ({ page }) => {
    await openAdminSection(page, "Haiga");
    const items = adminListItems(page);
    const initialCount = await items.count();

    try {
      // Create (persists an empty haiga to the list, then opens the editor)
      await createNewItem(page);
      await expect(page.getByText("Select Image")).toBeVisible();

      // KNOWN LIMITATION: the haiga editor has no input for the haiga's
      // lines, but validation requires a non-empty first line — so for a
      // freshly created haiga the save control is permanently disabled and
      // an edit-and-save journey cannot be exercised through the UI.
      // Asserted here so a future fix of the editor flags this test.
      await expect(
        iconButton(editorControls(page), "floppy-disk"),
      ).toHaveClass(/disabled/);

      await closeEditor(page);
      await expect(items).toHaveCount(initialCount + 1);

      // Delete the item we just appended
      await iconButton(items.last(), "trash").click();
      await confirmDialog(page, "Yes");
      await waitForIdle(page, 120_000);
      await expect(items).toHaveCount(initialCount);
    } finally {
      // Cleanup for mid-test failures: drop any items beyond the initial
      // count (bounded so a broken delete can't loop forever).
      await openAdminSection(page, "Haiga");
      for (let i = 0; i < 5 && (await items.count()) > initialCount; i++) {
        await iconButton(items.last(), "trash").click();
        await confirmDialog(page, "Yes");
        await waitForIdle(page, 120_000);
      }
    }
  });
});

test.describe("blog (other works)", () => {
  const marker = uniqueMarker("blog");

  test.afterEach(async ({ page }) => {
    await deleteItemsMatching(page, "Other works", marker);
  });

  test("draft posts do not appear on the public blog list", async ({
    page,
  }) => {
    await openAdminSection(page, "Other works");
    await createNewItem(page);
    await page.getByPlaceholder("Title").fill(marker);
    // Leave "Published" unchecked: this is a draft.
    await expect(
      page.locator(".blog-post-editor-status-checkbox"),
    ).not.toBeChecked();
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
    // Seeded published posts render, our draft does not.
    await expect(page.locator(".other-works-item").first()).toBeVisible();
    await expect(page.getByText(marker)).toHaveCount(0);

    // Cleanup happens in afterEach.
  });

  test("create a post with content and an image, publish it, and delete it", async ({
    page,
  }) => {
    await openAdminSection(page, "Other works");

    // Create a draft with rich-text content and an embedded image.
    await createNewItem(page);
    await page.getByPlaceholder("Title").fill(marker);
    const prose = page.locator(".tiptap-container .ProseMirror");
    await prose.click();
    await page.keyboard.type(`Body ${marker} content`);
    const chooser = page.waitForEvent("filechooser");
    await page
      .locator('.control-group button:has(svg[data-icon="image"])')
      .click();
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
    await iconButton(adminListItem(page, marker), "pencil").click();
    await expect(page.locator(".data-editor")).toBeVisible({
      timeout: 60_000,
    });
    await expect(prose).toContainText(`Body ${marker} content`);
    await expect(prose.locator('img[src*="/images/"]')).toHaveCount(1);

    // Edit the content and publish.
    await prose.locator("p", { hasText: marker }).first().click();
    await page.keyboard.type(" EDITED ");
    await page.locator(".blog-post-editor-status-checkbox").check();
    await saveEditor(page);
    await expect(page.locator(".data-editor")).toBeHidden({
      timeout: 180_000,
    });
    await expect(adminListItem(page, marker)).toContainText("Published");

    // Public page shows the post, its edited content, and the image now
    // published to S3.
    await page.goto("/other-works");
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

    // Delete (also removes the content document and its images).
    await openAdminSection(page, "Other works");
    await iconButton(adminListItem(page, marker), "trash").click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 180_000);
    await expect(adminListItem(page, marker)).toHaveCount(0);

    // Gone from the public list.
    const blogJson = page.waitForResponse((r) =>
      r.url().includes("blog-posts.json"),
    );
    await page.goto("/other-works");
    await blogJson;
    await expect(page.locator(".other-works-item").first()).toBeVisible();
    await expect(page.getByText(marker)).toHaveCount(0);
  });
});

test.describe("photography", () => {
  const marker = uniqueMarker("photo");

  test.afterEach(async ({ page }) => {
    await deleteItemsMatching(page, "Photography", marker);
  });

  test("create a post with an uploaded image, edit it, and delete it", async ({
    page,
  }) => {
    await openAdminSection(page, "Photography");

    // Create
    await createNewItem(page);
    await page.getByPlaceholder("Title").fill(marker);
    await page.getByPlaceholder("Subtitle").fill("e2e subtitle");
    await page.getByPlaceholder("Optional blurb").fill("e2e blurb");

    // Add an image: new picker slot, then pick the PNG fixture.
    const imagesSection = page.locator(".photography-post-editor-images");
    await iconButton(imagesSection, "plus").click();
    await imagesSection.locator('input[type="file"]').setInputFiles(
      pngFixturePath(),
    );
    // The chosen image shows up in the photo picker as a preview.
    await expect(imagesSection.locator(".photo-picker-image")).toBeVisible();
    await page
      .getByPlaceholder("image blurb or caption")
      .fill("e2e caption");

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
    await iconButton(row, "pencil").click();
    await expect(
      imagesSection.locator('.photo-picker-image[src*="/images/"]'),
    ).toBeVisible();
    // Edit the subtitle and save.
    await page.getByPlaceholder("Subtitle").fill("e2e subtitle edited");
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

    // Delete (removes the post and its uploaded images).
    await openAdminSection(page, "Photography");
    await iconButton(adminListItem(page, marker), "trash").click();
    await confirmDialog(page, "Yes");
    await waitForIdle(page, 180_000);
    await expect(adminListItem(page, marker)).toHaveCount(0);

    // Gone from the public page.
    const photographyJson = page.waitForResponse((r) =>
      r.url().includes("photography"),
    );
    await page.goto("/photography");
    await photographyJson;
    await expect(page.getByText(marker)).toHaveCount(0);
  });
});
