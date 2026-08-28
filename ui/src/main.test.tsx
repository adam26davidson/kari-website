import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import type { RouteObject } from "react-router";
// Deliberately the DOM entry point, matching main.tsx: react-router and
// react-router/dom export DIFFERENT RouterProvider functions, so importing
// the wrong one would make the identity assertion below silently vacuous.
import { RouterProvider } from "react-router/dom";

// main.tsx is the entry point: importing it mounts the app. Stub the DOM
// renderer so the import is observable without actually booting React,
// then assert on the element tree it hands to render().
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

  // Auth0 is deliberately absent from the entry point: the provider is
  // mounted per-route from a lazy chunk (see auth/admin-auth.tsx), so
  // public visitors never download the SDK. Issue #272.
  it("mounts the router without an Auth0 provider around it", async () => {
    const tree = await bootApp();
    expect(tree.props.children.type).toBe(RouterProvider);
  });

  it("drives routing through a data router matching every path", async () => {
    const routerProvider = (await bootApp()).props.children;
    const routes: RouteObject[] = routerProvider.props.router.routes;
    expect(routes.map((r) => r.path)).toEqual(["*"]);
  });
});
