import { describe, it, expect } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { useAuth0 } from "@auth0/auth0-react";
import {
  DEV_AUTH_TOKEN,
  FakeAuthProvider,
  REAL_AUTH_OVERRIDE_KEY,
} from "./fake-auth";

// The SDK is deliberately NOT mocked here: FakeAuthProvider's whole job is
// to satisfy the real `useAuth0`, so the probe below reads the context the
// same way every screen in the admin app does.

/** Renders what the app can see through `useAuth0()`. */
function Probe() {
  const { isAuthenticated, isLoading, user } = useAuth0();
  return (
    <ul>
      <li data-testid="authenticated">{String(isAuthenticated)}</li>
      <li data-testid="loading">{String(isLoading)}</li>
      <li data-testid="name">{user?.name}</li>
    </ul>
  );
}

/** The live context object, as any admin screen would receive it. */
function contextFromProvider() {
  return renderHook(() => useAuth0(), { wrapper: FakeAuthProvider }).result
    .current;
}

describe("FakeAuthProvider", () => {
  it("reports a signed-in session on the very first render", () => {
    render(
      <FakeAuthProvider>
        <Probe />
      </FakeAuthProvider>,
    );
    // No loading state to wait out: the admin shell renders its sign-in
    // screen while isLoading is true, and a capture or e2e run must never
    // photograph that.
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("name")).toHaveTextContent("Kari");
  });

  it("hands out the dev token the local API accepts", async () => {
    const token = await contextFromProvider().getAccessTokenSilently();
    expect(token).toBe(DEV_AUTH_TOKEN);
    // Kept in step with api/src/middleware/auth.rs, which holds the same
    // literal behind the `dev-auth` cargo feature.
    expect(DEV_AUTH_TOKEN).toBe("kari-dev-auth-token");
  });

  it("makes login and logout harmless no-ops", async () => {
    const { loginWithRedirect, logout } = contextFromProvider();
    const before = window.location.href;

    await expect(loginWithRedirect()).resolves.toBeUndefined();
    await expect(
      logout({ logoutParams: { returnTo: window.location.origin } }),
    ).resolves.toBeUndefined();

    // Nothing navigated: the session never ends, so the shell's sign-out
    // control and useAdminToken's expiry path both stay on the page.
    expect(window.location.href).toBe(before);
    await waitFor(() => expect(window.location.href).toBe(before));
  });

  it("names the localStorage key that opts back into real Auth0", () => {
    // Duplicated in e2e/admin-auth0-login.spec.ts, which cannot import from
    // the app; this pins the string both sides agree on.
    expect(REAL_AUTH_OVERRIDE_KEY).toBe("kari-auth-mode");
  });
});
