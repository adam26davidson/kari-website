import { test, expect } from "@playwright/test";

// The admin helper (#214), driven in a real browser against the local e2e
// stack, signed in by the test bundle's fake auth (#266) — no Auth0
// credentials needed.
//
// The local API has no ANTHROPIC_API_KEY — and neither does the deployed
// test environment until the maintainer adds one — so what this proves is
// the half that matters most: the feature degrades gracefully. The button
// is there on every admin page, the panel opens, and it says plainly that
// the helper is resting instead of showing a spinner, an error, or nothing
// at all. The admin around it keeps working.
//
// Read-only: opening the panel creates no conversation (the session is only
// created on the first message), so this leaves nothing behind and needs no
// cleanup.

const toggle = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Ask the helper" });

const panel = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "The helper" });

test.describe("admin: the helper", () => {
  test("waits in the corner of every admin page", async ({ page }) => {
    // It lives in the app shell rather than in a page, so it must survive a
    // client-side navigation between sections — that persistence is the
    // whole point of where it is mounted.
    await page.goto("/admin/haiku");
    await expect(toggle(page)).toBeVisible();

    await page.getByRole("link", { name: "Photography" }).click();
    await expect(page).toHaveURL(/\/admin\/photography/);
    await expect(toggle(page)).toBeVisible();
  });

  test("opens, and says plainly that the helper is resting", async ({
    page,
  }) => {
    await page.goto("/admin/haiku");
    await toggle(page).click();

    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText("resting right now");
    // No dead end: she can close it and carry on.
    await expect(panel(page)).toContainText("Everything else works as usual");

    // Nothing to type into when there is nobody to talk to.
    await expect(
      panel(page).getByRole("button", { name: "Send" }),
    ).toHaveCount(0);
  });

  test("opens straight away when the url asks it to", async ({ page }) => {
    // The hook e2e/screenshots.mjs uses to photograph the panel open.
    await page.goto("/admin/haiku?assistant=open");
    await expect(panel(page)).toBeVisible();
  });

  test("closes again and leaves the page as it was", async ({ page }) => {
    await page.goto("/admin/haiku");
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();

    await panel(page).getByRole("button", { name: "Close the helper" }).click();

    await expect(panel(page)).toHaveCount(0);
    await expect(toggle(page)).toBeVisible();
    // The haiku list is still there and still usable.
    await expect(
      page.getByRole("button", { name: "Add a haiku" }),
    ).toBeVisible();
  });
});
