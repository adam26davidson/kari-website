import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { AdminAuthProvider, HeaderUserSection } from "./admin-auth";

// Auth0Provider stays real so the assertions below identify it by
// reference; only the hook is stubbed, since HeaderUserSection needs a
// session without one existing.
vi.mock("@auth0/auth0-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@auth0/auth0-react")>()),
  useAuth0: vi.fn(),
}));

const logout = vi.fn();

function mockAuth0(overrides = {}) {
  vi.mocked(useAuth0).mockReturnValue({
    user: undefined,
    isAuthenticated: false,
    isLoading: false,
    logout,
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

describe("HeaderUserSection", () => {
  it("shows the signed-in user's name and a working logout button", async () => {
    mockAuth0({ user: { name: "Kari" }, isAuthenticated: true });
    render(<HeaderUserSection />);

    expect(screen.getByText("Kari")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });

  it("shows a logging-in message while Auth0 is loading", () => {
    mockAuth0({ isLoading: true });
    render(<HeaderUserSection />);
    expect(screen.getByText("Logging in...")).toBeInTheDocument();
  });

  it("renders nothing when nobody is signed in", () => {
    const { container } = render(<HeaderUserSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
