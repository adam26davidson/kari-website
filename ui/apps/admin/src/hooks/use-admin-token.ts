import { useAuth0 } from "@auth0/auth0-react";
import { useCallback } from "react";

/**
 * `getAccessTokenSilently`, but an expired or invalid Auth0 session sends
 * the user back through login (returning to /admin) instead of leaving the
 * UI stuck on a failed request.
 *
 * Contract: the returned getter keeps the same identity across re-renders
 * (it only changes if Auth0 hands back new functions), so it is safe in an
 * effect's dependency list — `useAssistantSession` relies on exactly that.
 * Test mocks must honour it too: use `./mock-admin-token`, which returns one
 * shared getter, rather than a factory that builds a fresh function per
 * render and makes such effects re-run until the test times out (#876).
 */
export function useAdminToken() {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0();

  return useCallback(async () => {
    try {
      // auth0-react >= 2.25 may resolve with no token; treat that like an
      // expired session rather than sending an unauthenticated request.
      const token = await getAccessTokenSilently();
      if (!token) throw new Error("Auth0 returned no access token");
      return token;
    } catch (error) {
      console.error("Auth session expired or invalid", error);
      await loginWithRedirect();
      // loginWithRedirect navigates away; throw so in-flight callers abort
      // instead of proceeding without a token.
      throw new Error("Session expired — redirecting to login", {
        cause: error,
      });
    }
  }, [getAccessTokenSilently, loginWithRedirect]);
}
