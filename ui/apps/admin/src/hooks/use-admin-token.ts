import { useAuth0 } from "@auth0/auth0-react";
import { useCallback } from "react";

/**
 * `getAccessTokenSilently`, but an expired or invalid Auth0 session sends
 * the user back through login (returning to /admin) instead of leaving the
 * UI stuck on a failed request.
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
