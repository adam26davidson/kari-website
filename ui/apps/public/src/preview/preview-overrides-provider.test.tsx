import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_OVERRIDES,
  PREVIEW_READY,
  PreviewOverrides,
} from "@kari/shared/utils/preview-channel";
import { PreviewOverridesProvider } from "./preview-overrides-provider";
import { usePreviewOverrides } from "./preview-overrides-context";
import { isPreviewMode } from "./preview-mode";

vi.mock("./preview-mode", () => ({ isPreviewMode: vi.fn() }));

function Consumer() {
  const { homePage } = usePreviewOverrides();
  return <div data-testid="blurb">{homePage?.blurb ?? "no override"}</div>;
}

/**
 * Dispatch a message the way the real editor's postMessage would arrive.
 *
 * Built by hand rather than by calling `window.postMessage`: jsdom delivers
 * its own postMessage with `origin: ""`, which the provider's same-origin
 * check correctly rejects — so a test driving the real API would only ever
 * exercise the rejection path.
 */
function postToWindow(data: unknown, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin }));
  });
}

const overridesMessage = (overrides: PreviewOverrides) => ({
  type: PREVIEW_OVERRIDES,
  overrides,
});

const homePage = { photo: "kari.jpg", blurb: "draft blurb", photoFile: null };

describe("PreviewOverridesProvider outside preview mode", () => {
  beforeEach(() => {
    vi.mocked(isPreviewMode).mockReturnValue(false);
  });

  it("renders its children with no overrides", () => {
    render(
      <PreviewOverridesProvider>
        <Consumer />
      </PreviewOverridesProvider>,
    );
    expect(screen.getByTestId("blurb")).toHaveTextContent("no override");
  });

  it("posts nothing to the parent window", () => {
    const post = vi.spyOn(window.parent, "postMessage");
    render(
      <PreviewOverridesProvider>
        <Consumer />
      </PreviewOverridesProvider>,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores an overrides message, having attached no listener", () => {
    render(
      <PreviewOverridesProvider>
        <Consumer />
      </PreviewOverridesProvider>,
    );
    postToWindow(overridesMessage({ homePage }));
    expect(screen.getByTestId("blurb")).toHaveTextContent("no override");
  });
});

describe("PreviewOverridesProvider in preview mode", () => {
  beforeEach(() => {
    vi.mocked(isPreviewMode).mockReturnValue(true);
  });

  const renderProvider = () =>
    render(
      <PreviewOverridesProvider>
        <Consumer />
      </PreviewOverridesProvider>,
    );

  it("tells the parent it is ready, targeting its own origin", () => {
    const post = vi.spyOn(window.parent, "postMessage");
    renderProvider();
    expect(post).toHaveBeenCalledWith(
      { type: PREVIEW_READY },
      window.location.origin,
    );
  });

  it("hands a delivered override to its children", () => {
    renderProvider();
    postToWindow(overridesMessage({ homePage }));
    expect(screen.getByTestId("blurb")).toHaveTextContent("draft blurb");
  });

  it("replaces earlier overrides with each new message", () => {
    renderProvider();
    postToWindow(overridesMessage({ homePage }));
    postToWindow(
      overridesMessage({ homePage: { ...homePage, blurb: "typed more" } }),
    );
    expect(screen.getByTestId("blurb")).toHaveTextContent("typed more");
  });

  it("rejects a message from another origin", () => {
    renderProvider();
    postToWindow(overridesMessage({ homePage }), "https://evil.example");
    expect(screen.getByTestId("blurb")).toHaveTextContent("no override");
  });

  it("ignores data that is not an overrides message", () => {
    renderProvider();
    // vite's HMR client and browser extensions post into this window too.
    postToWindow({ type: "vite:beforeUpdate" });
    postToWindow("webpackHotUpdate");
    expect(screen.getByTestId("blurb")).toHaveTextContent("no override");
  });

  it("ignores its own ready signal echoed back", () => {
    renderProvider();
    postToWindow({ type: PREVIEW_READY });
    expect(screen.getByTestId("blurb")).toHaveTextContent("no override");
  });

  it("stops listening once unmounted", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    renderProvider().unmount();
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
  });
});
