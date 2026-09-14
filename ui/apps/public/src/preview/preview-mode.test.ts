import { afterEach, describe, expect, it } from "vitest";
import { isPreviewMode } from "./preview-mode";

/**
 * jsdom gives every window `parent === window` (there is no frame), so the
 * framed case is faked by redefining `window.parent`. `search` is set
 * through history rather than by reassigning `location`, which jsdom does
 * not allow.
 */
function setUp({ search, framed }: { search: string; framed: boolean }) {
  window.history.replaceState({}, "", `/${search}`);
  Object.defineProperty(window, "parent", {
    value: framed ? ({} as Window) : window,
    configurable: true,
  });
}

describe("isPreviewMode", () => {
  afterEach(() => {
    setUp({ search: "", framed: false });
  });

  it("is true for a framed document asked for with ?preview=1", () => {
    setUp({ search: "?preview=1", framed: true });
    expect(isPreviewMode()).toBe(true);
  });

  it("is true for the bare ?preview flag, with no value", () => {
    setUp({ search: "?preview", framed: true });
    expect(isPreviewMode()).toBe(true);
  });

  it("is false for an ordinary visit", () => {
    setUp({ search: "", framed: false });
    expect(isPreviewMode()).toBe(false);
  });

  it("is false inside a frame with no preview flag", () => {
    // Someone else's page may embed the site; that does not make it a
    // preview pane, and it must get no listener.
    setUp({ search: "?utm_source=elsewhere", framed: true });
    expect(isPreviewMode()).toBe(false);
  });

  it("is false at the top level even when asked for with ?preview=1", () => {
    // A link to /?preview=1 cannot turn a visitor's tab into a pane
    // listening for injected content.
    setUp({ search: "?preview=1", framed: false });
    expect(isPreviewMode()).toBe(false);
  });
});
