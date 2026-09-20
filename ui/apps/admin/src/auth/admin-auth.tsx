import { Auth0Provider } from "@auth0/auth0-react";
import { ReactNode } from "react";
import { FakeAuthProvider, REAL_AUTH_OVERRIDE_KEY } from "./fake-auth";

/**
 * Everything in this app that talks to Auth0. It used to be reached through
 * a lazy chunk so that `@auth0/auth0-react` never reached a public visitor
 * (issue #272 — the SDK was 212 kB of the 514 kB entry chunk everyone
 * downloaded). The admin is its own build now (#591), so that separation is
 * structural and these can be imported normally.
 */

/**
 * Auth0 session boundary, mounted around the whole admin app in main.tsx —
 * the shell included, since its sidebar shows the signed-in user and its
 * sign-out control outside the route outlet.
 */
export function AdminAuthProvider({ children }: { children?: ReactNode }) {
  // Dev and test builds sign themselves in (#266), so the admin UI runs
  // with no Auth0 credentials and no login round trip. VITE_AUTH_MODE is
  // set in .env.development and .env.test only; in a staging/production
  // build vite substitutes the literal `undefined` for the unset key, this
  // condition folds to `false`, and ./fake-auth is tree-shaken away — the
  // same mechanism the VITE_SHOW_TEST_STATUS gate relies on, and CI greps
  // dist/ to prove it. A real env var beats the file, so
  // `VITE_AUTH_MODE=auth0 ./scripts/dev.sh` opts back into Auth0.
  //
  // The localStorage escape hatch is deliberately INSIDE this branch
  // rather than beside it: it only has to work in a fake-enabled build
  // (it is how e2e/admin-auth0-login.spec.ts drives the real Auth0
  // integration against the test bundle), and putting it here means it
  // folds away with everything else instead of leaving a runtime switch
  // in the deployed admin.
  if (
    import.meta.env.VITE_AUTH_MODE === "fake" &&
    window.localStorage.getItem(REAL_AUTH_OVERRIDE_KEY) !== "auth0"
  ) {
    return <FakeAuthProvider>{children}</FakeAuthProvider>;
  }

  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin + "/admin",
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
      // Test builds persist tokens to localStorage so Playwright can capture
      // an authenticated storageState once and reuse it across e2e tests.
      // Production keeps the default in-memory cache.
      cacheLocation={
        import.meta.env.MODE === "test" ? "localstorage" : undefined
      }
    >
      {children}
    </Auth0Provider>
  );
}
