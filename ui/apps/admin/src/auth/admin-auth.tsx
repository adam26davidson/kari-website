import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { ReactNode } from "react";
import { faUser, faRightFromBracket } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { SiteButton } from "../components/site-button/site-button";

/**
 * Every piece of the app that talks to Auth0 from outside the /admin
 * route tree lives here, in one module, so `@auth0/auth0-react` lands in
 * a chunk of its own that only admin routes ever fetch (issue #272 — the
 * SDK was 212 kB of the 514 kB entry chunk that every visitor
 * downloaded). Import it through `lazy-admin-auth.ts`, never directly:
 * a static import from app.tsx or header.tsx puts the SDK straight back
 * into the entry chunk.
 */

/**
 * Auth0 session boundary for the admin section. Rendered around the whole
 * app shell — including the header — but only while an /admin route is
 * active, so `useAuth0` has a provider wherever admin code runs and
 * public pages carry none of it.
 */
// `children` is optional so the component type stays assignable to
// React's bare `ComponentType`, which is what `lazyWithRetry` accepts.
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

/**
 * The signed-in user and logout control shown in the admin header. Lives
 * here rather than in header.tsx because it is the header's only use of
 * Auth0, and header.tsx renders on every public page.
 */
export function HeaderUserSection() {
  const { user, isAuthenticated, isLoading, logout } = useAuth0();

  if (isLoading) return <>Logging in...</>;
  if (!isAuthenticated) return null;

  return (
    <div className="header-user-section">
      <FontAwesomeIcon icon={faUser} />
      <div className="header-user-name">{user?.name}</div>
      <SiteButton
        onClick={() =>
          logout({ logoutParams: { returnTo: window.location.origin } })
        }
      >
        <FontAwesomeIcon icon={faRightFromBracket} />
      </SiteButton>
    </div>
  );
}
