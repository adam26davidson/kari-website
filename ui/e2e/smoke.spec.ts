import { test, expect } from "@playwright/test";

// Smoke tests: the app boots and its shell renders without a working backend.
// The header title and nav are network-independent, so these assertions are
// stable even when the API/S3/Auth0 are unreachable in CI.

test("home page renders the site header", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Kari Davidson")).toBeVisible();
});

test("primary navigation links are present", async ({ page }) => {
  await page.goto("/");
  // Desktop nav renders anchor links for the main pages.
  await expect(page.getByRole("link", { name: /haiku/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /haiga/i })).toBeVisible();
});

test("app does not crash into a blank page", async ({ page }) => {
  await page.goto("/");
  // The mounted React tree fills #root; a white-screen crash leaves it empty.
  const root = page.locator("#root");
  await expect(root).not.toBeEmpty();
});

test("navigating to the haiku route keeps the app mounted", async ({ page }) => {
  await page.goto("/haiku");
  await expect(page.getByText("Kari Davidson")).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
});

// The admin app is a separate build served under /admin (#591). These pin
// the two things that split can break without any test noticing: that the
// path serves the admin document at all, and that a DEEP link into it does
// too — a single-document SPA fallback would answer /admin/haiku with the
// public index, which renders the public site under an admin URL rather
// than failing.
test("/admin serves the admin app", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText("Kari Davidson - Admin")).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
});

test("a deep admin link serves the admin app, not the public one", async ({
  page,
}) => {
  await page.goto("/admin/haiku");
  await expect(page.getByText("Kari Davidson - Admin")).toBeVisible();
  // The public header would be here instead if the fallback were wrong.
  await expect(page.locator(".header")).toHaveCount(0);
});

test("the public header links out to the admin app", async ({ page }) => {
  await page.goto("/");
  const admin = page.getByRole("link", { name: "Admin" });
  await expect(admin).toHaveAttribute("href", "/admin");
  await admin.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Kari Davidson - Admin")).toBeVisible();
});
