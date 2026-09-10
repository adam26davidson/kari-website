import { useAuth0 } from "@auth0/auth0-react";

/** Who is signed in, and the one thing the shell lets them do about it. */
export interface AdminAccount {
  /**
   * The signed-in person's display name. Auth0 falls back to the email
   * address for an account with no name set, so this can be long — every
   * place the shell shows it has to be able to give (#573).
   */
  name: string;
  /** The initial the sidebar's avatar shows, uppercased. */
  initial: string;
  signOut: () => void;
}

/**
 * The signed-in account, for the parts of the shell that show it.
 *
 * A hook of its own rather than another export of admin-auth.tsx: that file
 * exports a component, and `react-refresh/only-export-components` — which
 * `npm run lint` runs as an error at `--max-warnings 0` — wants a module
 * that exports a component to export nothing else.
 */
export function useAdminAccount(): AdminAccount {
  const { user, logout } = useAuth0();
  const name = user?.name ?? "";
  return {
    name,
    initial: name.trim().charAt(0).toUpperCase(),
    signOut: () =>
      logout({ logoutParams: { returnTo: window.location.origin } }),
  };
}
