import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { AdminAuthProvider } from "./admin-auth";

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
});
