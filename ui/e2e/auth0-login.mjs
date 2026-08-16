// The Auth0 Universal Login dance, shared by auth.setup.ts (which captures
// storageState for the admin e2e project) and screenshots.mjs (which
// authenticates a context to capture the admin pages). One implementation on
// purpose: the selectors below track Auth0's rendered login form, and when
// Auth0 changes it, this is the only place to fix.
//
// Plain ESM JavaScript (with JSDoc types) like config.mjs, and plain
// Playwright page APIs (no @playwright/test fixtures), so it works both
// inside the test runner and in standalone scripts.

/** @param {string} value */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Logs into the app as the admin user through the real Auth0 Universal
 * Login, starting from `${baseUrl}/admin` and resolving once the admin menu
 * is visible (by which point the Auth0 SPA SDK has written its token cache).
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ baseUrl: string, username: string, password: string }} options
 */
export async function loginAsAdmin(page, { baseUrl, username, password }) {
  const returnUrl = new RegExp(
    `${escapeRegex(new URL(baseUrl).host)}/admin`,
  );

  await page.goto(`${baseUrl}/admin`);
  await page.locator(".admin-button", { hasText: "Log In" }).click();

  // Auth0 Universal Login. The new (default) experience uses
  // input[name="username"] / input[name="password"]; older or customized
  // forms may use name="email". Identifier-first flows show the password
  // field only after submitting the username.
  await page.waitForURL(/auth0\.com/, { timeout: 60_000 });
  const usernameInput = page
    .locator('input[name="username"], input[name="email"], input#username')
    .first();
  await usernameInput.waitFor({ state: "visible", timeout: 30_000 });
  await usernameInput.fill(username);

  // The page also contains an aria-hidden Continue button (Auth0's Enter-key
  // default-action catcher) that matches button[type="submit"] but can never
  // be clicked. Role-based locators exclude aria-hidden elements, so this
  // always resolves to the visible button. "Continue" is exact to avoid
  // matching social-login buttons like "Continue with Google".
  const continueButton = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });

  const passwordInput = page
    .locator('input[name="password"], input#password')
    .first();
  if (!(await passwordInput.isVisible())) {
    // Identifier-first: submit the username to reveal the password screen.
    await continueButton.click();
    await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
  }
  await passwordInput.fill(password);
  await continueButton.click();

  // Auth0 may interpose a consent screen for localhost callback URLs.
  const consentAccept = page.locator(
    'button[name="action"][value="accept"], button:has-text("Accept")',
  );
  try {
    await page.waitForURL(returnUrl, { timeout: 20_000 });
  } catch {
    // Not back at the app: either a consent screen (fine, accept it) or a
    // login failure. Surface Auth0's own error message when there is one —
    // "Wrong email or password" here means the E2E_AUTH0_* credentials don't
    // match a user in the tenant, which no code change can fix.
    if (!(await consentAccept.first().isVisible().catch(() => false))) {
      const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      const details = bodyText
        .replace(/\s+/g, " ")
        .match(
          /wrong email or password|your account has been blocked|too many attempts|verify your email|something went wrong/i,
        )?.[0];
      throw new Error(
        `Auth0 login did not return to the app. ${
          details
            ? `Auth0 reports: "${details}" — check the E2E_AUTH0_USERNAME / ` +
              "E2E_AUTH0_PASSWORD credentials against the test user in the " +
              "kari-website connection."
            : `Stuck on ${page.url()} with no consent screen or known ` +
              "error message; inspect the trace."
        }`,
      );
    }
    await consentAccept.first().click();
    await page.waitForURL(returnUrl, { timeout: 60_000 });
  }

  // The admin menu only renders once Auth0 reports isAuthenticated, and by
  // then the SPA SDK has written its token cache to localStorage.
  await page
    .locator(".admin-menu-item", { hasText: "Haiku" })
    .waitFor({ state: "visible", timeout: 60_000 });
}
