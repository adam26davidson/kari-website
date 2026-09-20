import {
  Auth0Context,
  Auth0ContextInterface,
  initialContext,
} from "@auth0/auth0-react";
import { ReactNode } from "react";

/**
 * A stand-in for Auth0 used by local dev and test builds only (#266), so
 * the admin UI can be run, driven by Playwright and screenshotted without
 * Auth0 credentials and without paying for a real login on every run.
 *
 * It is NOT a security boundary and never ships: the only thing that
 * renders it is a branch in `admin-auth.tsx` guarded by
 * `import.meta.env.VITE_AUTH_MODE === "fake"`, and `VITE_AUTH_MODE` is set
 * in `.env.development` and `.env.test` only. In a staging/production build
 * vite replaces the unset key with the literal `undefined`, the condition
 * folds to `false`, and this module is tree-shaken out of the bundle
 * entirely — CI greps `dist/` for the two constants below to prove it.
 *
 * It provides the real `Auth0Context` rather than a new abstraction, so
 * every `useAuth0()` call site in the app (and every unit test that mocks
 * the SDK) is untouched.
 */

/**
 * The bearer token the fake session hands out. The API accepts it only when
 * it was built with the `dev-auth` cargo feature AND `KARI_DEV_AUTH=1` is
 * set — see `api/src/middleware/auth.rs`, which holds the same string.
 * Public by design, not a secret.
 */
export const DEV_AUTH_TOKEN = "kari-dev-auth-token";

/**
 * localStorage key that opts a fake-auth-enabled build BACK into real
 * Auth0, for the one e2e journey that exercises the actual Auth0
 * integration (`e2e/admin-auth0-login.spec.ts`).
 *
 * It lives here, inside the module that only exists in fake-enabled
 * builds, precisely so the escape hatch cannot reach a deployed bundle
 * either: both constants disappear together.
 */
export const REAL_AUTH_OVERRIDE_KEY = "kari-auth-mode";

/**
 * A signed-in Auth0 session, frozen. Everything the app never calls is
 * spread in from the SDK's own `initialContext` (whose stubs throw if
 * something unexpected reaches for them) rather than re-stubbed here —
 * twenty hand-written no-ops would be twenty untested functions against
 * the admin app's coverage floor, and none of them would be more honest
 * than the SDK's.
 */
const FAKE_CONTEXT: Auth0ContextInterface = {
  ...initialContext,
  isAuthenticated: true,
  isLoading: false,
  error: undefined,
  // The name shows in the sidebar avatar and the home editor's greeting.
  user: { name: "Kari", sub: "dev|local-admin" },
  // `getAccessTokenSilently` is overloaded (`detailedResponse: true`
  // returns an object), so a plain string-returning async function needs
  // the cast to be assignable.
  getAccessTokenSilently: (async () =>
    DEV_AUTH_TOKEN) as Auth0ContextInterface["getAccessTokenSilently"],
  // Already signed in, so there is nothing to redirect to or away from —
  // but the app does call both, and a throwing stub would break the
  // sidebar's sign-out control and `useAdminToken`'s error path.
  loginWithRedirect: async () => {},
  logout: async () => {},
};

/** Mounts the frozen session above as the app's Auth0 context. */
export function FakeAuthProvider({ children }: { children?: ReactNode }) {
  return (
    <Auth0Context.Provider value={FAKE_CONTEXT}>
      {children}
    </Auth0Context.Provider>
  );
}
