import { test, expect } from "@playwright/test";
import { PORT } from "../playwright.config";
import { loginAsAdmin } from "./auth0-login.mjs";
import { adminListItems, openAdminSection } from "./helpers";

// The one journey that still exercises the REAL Auth0 integration (#266).
//
// Every other admin spec runs against a bundle that signs itself in, which
// is what makes them credential-free and fast — and which would also let
// the actual Auth0 setup (tenant, client id, callback URL, audience, JWKS
// validation in the API) rot silently. So this spec exists: real Universal
// Login, a real token, one authenticated read.
//
// It runs only when E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD are set — they
// are in CI, and the "auth0-login" project simply is not built without
// them. The `admin-` filename prefix is load-bearing: the credential-free
// visitor project ignores every `admin-*.spec.ts`, and without it this
// would run there and fail on a login page it has no password for.
//
// Read-only, so it needs no cleanup and no serialization.

/**
 * localStorage key that makes the fake-auth-enabled test bundle fall
 * through to the real Auth0Provider. Duplicated by hand from
 * apps/admin/src/auth/fake-auth.tsx (REAL_AUTH_OVERRIDE_KEY) — the e2e
 * suite is its own TypeScript project and cannot import from the apps,
 * the same reason admin-whats-on-test.spec.ts re-declares the two URLs it
 * intercepts. A unit test there pins the same string.
 */
const REAL_AUTH_OVERRIDE_KEY = "kari-auth-mode";

test("signs in through real Auth0 and reads a protected list", async ({
  page,
}) => {
  const username = process.env.E2E_AUTH0_USERNAME;
  const password = process.env.E2E_AUTH0_PASSWORD;
  if (!username || !password) {
    throw new Error("E2E_AUTH0_USERNAME / E2E_AUTH0_PASSWORD must be set");
  }

  // Before any app code runs, so AdminAuthProvider sees it on first render.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [REAL_AUTH_OVERRIDE_KEY, "auth0"] as const,
  );

  await loginAsAdmin(page, {
    baseUrl: `http://localhost:${PORT}`,
    username,
    password,
  });

  // Photography is a `secure_routes` GET, so a populated list proves the
  // API validated the REAL Auth0 access token — /haiku is public and would
  // prove nothing about the token at all.
  await openAdminSection(page, "Photography");
  await expect(adminListItems(page).first()).toBeVisible();
});
