import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { Auth0Provider } from "@auth0/auth0-react";
import { RouterProvider } from "react-router-dom";

// main.tsx is the entry point: importing it mounts the app. Stub the DOM
// renderer so the import is observable without actually booting React
// (which would put Auth0 on the network), then assert on the element tree
// it hands to render().
const render = vi.fn();
const createRoot = vi.fn(() => ({ render, unmount: vi.fn() }));
vi.mock("react-dom/client", () => ({
  default: { createRoot },
  createRoot,
}));

/** Re-imports main.tsx from scratch so each test sees a fresh mount. */
async function bootApp() {
  vi.resetModules();
  await import("./main");
  return render.mock.calls[0][0];
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  createRoot.mockClear();
  render.mockClear();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "tenant.test.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "test-client-id");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.test.local/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe("main entry point", () => {
  it("mounts the app into the #root element", async () => {
    await bootApp();
    expect(createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("renders the app inside StrictMode", async () => {
    const tree = await bootApp();
    expect(tree.type).toBe(React.StrictMode);
  });

  it("configures Auth0 from the build's env vars", async () => {
    const provider = (await bootApp()).props.children;
    expect(provider.type).toBe(Auth0Provider);
    expect(provider.props.domain).toBe("tenant.test.auth0.com");
    expect(provider.props.clientId).toBe("test-client-id");
    expect(provider.props.authorizationParams).toEqual({
      redirect_uri: window.location.origin + "/admin",
      audience: "https://api.test.local/",
    });
  });

  it("sends the Auth0 callback back to /admin on this origin", async () => {
    const provider = (await bootApp()).props.children;
    expect(provider.props.authorizationParams.redirect_uri).toBe(
      `${window.location.origin}/admin`,
    );
  });

  it("persists Auth0 tokens to localStorage in test builds", async () => {
    vi.stubEnv("MODE", "test");
    const provider = (await bootApp()).props.children;
    expect(provider.props.cacheLocation).toBe("localstorage");
  });

  it("keeps the default in-memory Auth0 cache outside test builds", async () => {
    vi.stubEnv("MODE", "production");
    const provider = (await bootApp()).props.children;
    expect(provider.props.cacheLocation).toBeUndefined();
  });

  it("drives routing through a data router matching every path", async () => {
    const provider = (await bootApp()).props.children;
    const routerProvider = provider.props.children;
    expect(routerProvider.type).toBe(RouterProvider);
    expect(routerProvider.props.router.routes.map((r) => r.path)).toEqual([
      "*",
    ]);
  });
});
