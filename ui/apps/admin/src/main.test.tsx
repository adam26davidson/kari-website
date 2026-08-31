import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import type { RouteObject } from "react-router";
// Deliberately the DOM entry point, matching main.tsx: react-router and
// react-router/dom export DIFFERENT RouterProvider functions, so importing
// the wrong one would make the identity assertion below silently vacuous.
import { RouterProvider } from "react-router/dom";
import { AdminAuthProvider } from "./auth/admin-auth";

// main.tsx is the entry point: importing it mounts the app. Stub the DOM
// renderer so the import is observable without actually booting React,
// then assert on the element tree it hands to render().
const render = vi.fn();
const createRoot = vi.fn(() => ({ render, unmount: vi.fn() }));
vi.mock("react-dom/client", () => ({
  default: { createRoot },
  createRoot,
}));

// The provider itself is covered by auth/admin-auth.test.tsx; here it only
// has to be identifiable in the tree.
vi.mock("./auth/admin-auth", () => ({
  AdminAuthProvider: () => null,
  HeaderUserSection: () => null,
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
  document.body.innerHTML = "";
});

describe("admin entry point", () => {
  it("mounts the app into the #root element", async () => {
    await bootApp();
    expect(createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("renders the app inside StrictMode", async () => {
    const tree = await bootApp();
    expect(tree.type).toBe(React.StrictMode);
  });

  // Unlike the public site, this app IS the admin section, so the Auth0
  // session boundary is static and wraps everything — every route below it
  // needs a session. Issue #272 put the SDK behind a lazy chunk to keep it
  // away from public visitors; the split in #591 does that structurally.
  it("wraps the whole router in the Auth0 session boundary", async () => {
    const boundary = (await bootApp()).props.children;
    expect(boundary.type).toBe(AdminAuthProvider);
    expect(boundary.props.children.type).toBe(RouterProvider);
  });

  // The app is served under /admin, so the router carries that basename:
  // routes and links inside are written as if this app owned the site root.
  it("drives routing through a data router based at /admin", async () => {
    const router = (await bootApp()).props.children.props.children.props.router;
    const routes: RouteObject[] = router.routes;
    expect(routes.map((r) => r.path)).toEqual(["*"]);
    expect(router.basename).toBe("/admin");
  });
});
