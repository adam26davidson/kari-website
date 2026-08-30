import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { ReactNode } from "react";
import { faUser, faRightFromBracket } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { SiteButton } from "@kari/shared/components/site-button/site-button";

/**
 * Everything in this app that talks to Auth0. It used to be reached through
 * a lazy chunk so that `@auth0/auth0-react` never reached a public visitor
 * (issue #272 — the SDK was 212 kB of the 514 kB entry chunk everyone
 * downloaded). The admin is its own build now (#591), so that separation is
 * structural and these can be imported normally.
 */

/**
 * Auth0 session boundary, mounted around the whole admin app in main.tsx —
 * the header included, since it renders the signed-in user outside the
 * route outlet.
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

/** The signed-in user and logout control shown in the admin header. */
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
