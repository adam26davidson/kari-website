import fs from "node:fs";
import path from "node:path";
import { test as setup, expect, APIRequestContext } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "../playwright.config";
import { TEST_API_URL } from "./helpers";

// Logs into the app once through the real Auth0 Universal Login and saves the
// browser storage state (Auth0 SPA token cache lives in localStorage in test
// builds) for the admin project to reuse. This file only runs when
// E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD are present — the config drops the
// setup + admin projects otherwise.

/**
 * The API runs on localhost (the CI job starts it before Playwright; for
 * local runs you start it yourself). Fail fast with a clear message if it
 * isn't up — /health also probes S3 read/write, so this catches missing or
 * expired AWS credentials too.
 */
async function checkApiIsUp(request: APIRequestContext) {
  const deadline = Date.now() + 30_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await request.get(`${TEST_API_URL}/health`, {
        timeout: 10_000,
      });
      if (response.ok()) return;
      const body = (await response.text())
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      lastError = `HTTP ${response.status()}: ${body}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `API at ${TEST_API_URL} is not healthy (${lastError}). ` +
      "For local runs, start the API first: `aws sso login`, then " +
      "`cargo run` in api/ (its .env already targets the test bucket).",
  );
}

setup("authenticate as admin", async ({ page, request }) => {
  const username = process.env.E2E_AUTH0_USERNAME;
  const password = process.env.E2E_AUTH0_PASSWORD;
  if (!username || !password) {
    throw new Error("E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD must be set");
  }

  await checkApiIsUp(request);

  await page.goto("/admin");
  await page.locator(".admin-button", { hasText: "Log In" }).click();

  // Auth0 Universal Login. The new (default) experience uses
  // input[name="username"] / input[name="password"]; older or customized
  // forms may use name="email". Identifier-first flows show the password
  // field only after submitting the username.
  await page.waitForURL(/auth0\.com/, { timeout: 60_000 });
  const usernameInput = page
    .locator('input[name="username"], input[name="email"], input#username')
    .first();
  await expect(usernameInput).toBeVisible({ timeout: 30_000 });
  await usernameInput.fill(username);

  const passwordInput = page
    .locator('input[name="password"], input#password')
    .first();
  if (!(await passwordInput.isVisible())) {
    // Identifier-first: submit the username to reveal the password screen.
    await page.locator('button[type="submit"]').first().click();
    await expect(passwordInput).toBeVisible({ timeout: 30_000 });
  }
  await passwordInput.fill(password);
  await page.locator('button[type="submit"]').first().click();

  // Auth0 may interpose a consent screen for localhost callback URLs.
  const consentAccept = page.locator(
    'button[name="action"][value="accept"], button:has-text("Accept")',
  );
  try {
    await page.waitForURL(/localhost:4173\/admin/, { timeout: 20_000 });
  } catch {
    await expect(consentAccept.first()).toBeVisible({ timeout: 10_000 });
    await consentAccept.first().click();
    await page.waitForURL(/localhost:4173\/admin/, { timeout: 60_000 });
  }

  // The admin menu only renders once Auth0 reports isAuthenticated, and by
  // then the SPA SDK has written its token cache to localStorage.
  await expect(
    page.locator(".admin-menu-item", { hasText: "Haiku" }),
  ).toBeVisible({ timeout: 60_000 });

  fs.mkdirSync(path.dirname(ADMIN_STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
