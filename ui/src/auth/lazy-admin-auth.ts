import { lazyWithRetry } from "../components/error-boundary/lazy-with-retry";

/**
 * Lazy handles for the Auth0-backed pieces in `admin-auth.tsx`. Both point
 * at the same module, so the SDK arrives in one chunk that is fetched only
 * once, and only when an /admin route is active — keeping ~212 kB of
 * `@auth0/auth0-react` out of the entry chunk every visitor downloads
 * (issue #272).
 *
 * Anything on the always-loaded path (app.tsx, header.tsx) must import
 * from here rather than from `./admin-auth`.
 */
export const AdminAuthProvider = lazyWithRetry(() =>
  import("./admin-auth").then((m) => ({
    default: m.AdminAuthProvider,
  })),
);

export const HeaderUserSection = lazyWithRetry(() =>
  import("./admin-auth").then((m) => ({
    default: m.HeaderUserSection,
  })),
);
