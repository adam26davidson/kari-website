import { test as setup, APIRequestContext } from "@playwright/test";
import { S3_START_COMMAND } from "./config.mjs";
import { TEST_API_URL } from "./helpers";

// A dependency project that every admin suite waits on: it does not log
// anyone in (the test bundle signs itself in — see #266 and
// apps/admin/src/auth/fake-auth.tsx), it just proves the local stack is
// actually there before a browser goes looking for it. Without this, a
// missing API surfaces as a dozen unrelated content assertions timing out.

/**
 * The API runs on localhost (the CI job starts it before Playwright; for
 * local runs you start it yourself). Fail fast with a clear message if it
 * isn't up — /health also probes S3 read/write, so this catches a missing
 * or unseeded local S3 too.
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
      "For local runs, start the local S3:\n" +
      S3_START_COMMAND +
      "\nseed it (`node e2e/seed.mjs`), and then " +
      "`cargo run --features dev-auth` in api/ — that feature is what " +
      "makes the API accept the admin journeys' dev token, and api/.env " +
      "already sets KARI_DEV_AUTH=1 and targets the local S3.",
  );
}

setup("local stack is up", async ({ request }) => {
  await checkApiIsUp(request);
});
