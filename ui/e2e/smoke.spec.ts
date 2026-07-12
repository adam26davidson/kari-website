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
