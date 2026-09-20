import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { AdminAuthProvider } from "./admin-auth";
import { FakeAuthProvider, REAL_AUTH_OVERRIDE_KEY } from "./fake-auth";

// Auth0Provider stays real so the assertions below identify it by
// reference; only the hook is stubbed, so nothing here reaches the network.
vi.mock("@auth0/auth0-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@auth0/auth0-react")>()),
  useAuth0: vi.fn(),
}));

function mockAuth0(overrides = {}) {
  vi.mocked(useAuth0).mockReturnValue({
    user: undefined,
    isAuthenticated: false,
    isLoading: false,
    ...overrides,
  } as unknown as ReturnType<typeof useAuth0>);
}

beforeEach(() => {
  mockAuth0();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "tenant.test.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "test-client-id");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.test.local/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  // The fake-auth escape hatch reads localStorage; a leftover value would
  // silently change which provider the next case gets.
  window.localStorage.clear();
});

// AdminAuthProvider is a pure wrapper with no hooks of its own, so
// calling it yields the element tree it would mount — enough to assert
// the Auth0 configuration without booting Auth0 against the network.
function providerElement() {
  return AdminAuthProvider({ children: <div>protected</div> });
}

describe("AdminAuthProvider", () => {
  it("wraps its children in an Auth0Provider", () => {
    const tree = providerElement();
    expect(tree.type).toBe(Auth0Provider);
    expect(tree.props.children).toEqual(<div>protected</div>);
  });

  it("configures Auth0 from the build's env vars", () => {
    const tree = providerElement();
    expect(tree.props.domain).toBe("tenant.test.auth0.com");
    expect(tree.props.clientId).toBe("test-client-id");
    expect(tree.props.authorizationParams).toEqual({
      redirect_uri: window.location.origin + "/admin",
      audience: "https://api.test.local/",
    });
  });

  it("sends the Auth0 callback back to /admin on this origin", () => {
    expect(providerElement().props.authorizationParams.redirect_uri).toBe(
      `${window.location.origin}/admin`,
    );
  });

  it("persists Auth0 tokens to localStorage in test builds", () => {
    vi.stubEnv("MODE", "test");
    expect(providerElement().props.cacheLocation).toBe("localstorage");
  });

  it("keeps the default in-memory Auth0 cache outside test builds", () => {
    vi.stubEnv("MODE", "production");
    expect(providerElement().props.cacheLocation).toBeUndefined();
  });

  // #266. Every case above leaves VITE_AUTH_MODE unset, which is what a
  // staging/production build looks like — so they already pin "real Auth0
  // unless told otherwise".
  describe("with fake auth enabled (dev and test builds)", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_AUTH_MODE", "fake");
    });

    it("signs the app in with the fake provider instead of Auth0", () => {
      const tree = providerElement();
      expect(tree.type).toBe(FakeAuthProvider);
      expect(tree.props.children).toEqual(<div>protected</div>);
    });

    it("falls back to real Auth0 when localStorage opts in", () => {
      window.localStorage.setItem(REAL_AUTH_OVERRIDE_KEY, "auth0");
      const tree = providerElement();
      // The escape hatch the one credential-gated e2e journey uses: same
      // Auth0 configuration as a deployed build.
      expect(tree.type).toBe(Auth0Provider);
      expect(tree.props.domain).toBe("tenant.test.auth0.com");
      expect(tree.props.clientId).toBe("test-client-id");
      expect(tree.props.authorizationParams).toEqual({
        redirect_uri: window.location.origin + "/admin",
        audience: "https://api.test.local/",
      });
    });

    it("ignores any other value of the override key", () => {
      window.localStorage.setItem(REAL_AUTH_OVERRIDE_KEY, "yes please");
      expect(providerElement().type).toBe(FakeAuthProvider);
    });
  });

  it("uses real Auth0 for any VITE_AUTH_MODE other than fake", () => {
    vi.stubEnv("VITE_AUTH_MODE", "auth0");
    expect(providerElement().type).toBe(Auth0Provider);
  });
});
