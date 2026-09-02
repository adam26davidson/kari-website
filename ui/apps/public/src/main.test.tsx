import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { BrowserRouter } from "react-router";

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

  // Auth0 is deliberately absent from the entry point: the admin app is a
  // separate build served under /admin, so public visitors never download
  // the SDK. Issues #272 and #591.
  it("mounts the router without an Auth0 provider around it", async () => {
    const tree = await bootApp();
    expect(tree.props.children.type).toBe(BrowserRouter);
  });

  // The declarative router, NOT a data router: createBrowserRouter pulls
  // ~56 kB of data-router machinery into the entry chunk every visitor
  // downloads, and the only thing that ever needed it -- the admin
  // unsaved-changes guard's useBlocker -- lives in the admin app now
  // (issue #533). App owns the route tree below this via descendant
  // <Routes>, so there is nothing here to declare.
  it("drives routing through the declarative router around App", async () => {
    const router = (await bootApp()).props.children;
    // No `router` prop is the tell that this is <BrowserRouter> and not
    // RouterProvider: the two share nothing else at this level.
    expect(router.props.router).toBeUndefined();
    // Imported AFTER bootApp's vi.resetModules(), so this resolves to the
    // same module instance main.tsx just rendered; a top-level import
    // would be a different copy and the identity check would fail.
    const { App } = await import("./app");
    expect(router.props.children.type).toBe(App);
  });
});
