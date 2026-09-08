import { Auth0Provider } from "@auth0/auth0-react";
import { ReactNode } from "react";

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
