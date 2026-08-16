import fs from "node:fs";
import path from "node:path";
import { test as setup, expect, APIRequestContext } from "@playwright/test";
import { ADMIN_STORAGE_STATE, PORT } from "../playwright.config";
import { MINIO_START_COMMAND } from "./config.mjs";
import { loginAsAdmin } from "./auth0-login.mjs";
import { TEST_API_URL } from "./helpers";

// Logs into the app once through the real Auth0 Universal Login (the shared
// flow in auth0-login.mjs) and saves the browser storage state (Auth0 SPA
// token cache lives in localStorage in test builds) for the admin project to
// reuse. This file only runs when E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD
// are present — the config drops the setup + admin projects otherwise.

/**
 * The API runs on localhost (the CI job starts it before Playwright; for
 * local runs you start it yourself). Fail fast with a clear message if it
 * isn't up — /health also probes S3 read/write, so this catches a missing
 * or unseeded local MinIO too.
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
      "For local runs, start the local MinIO:\n" +
      MINIO_START_COMMAND +
      "\nseed it (`node e2e/seed.mjs`), and then `cargo run` in api/ " +
      "(its .env already targets it).",
  );
}

setup("authenticate as admin", async ({ page, request }) => {
  const username = process.env.E2E_AUTH0_USERNAME;
  const password = process.env.E2E_AUTH0_PASSWORD;
  if (!username || !password) {
    throw new Error("E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD must be set");
  }

  await checkApiIsUp(request);

  await loginAsAdmin(page, {
    baseUrl: `http://localhost:${PORT}`,
    username,
    password,
  });
  await expect(
    page.locator(".admin-menu-item", { hasText: "Haiku" }),
  ).toBeVisible();

  fs.mkdirSync(path.dirname(ADMIN_STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
