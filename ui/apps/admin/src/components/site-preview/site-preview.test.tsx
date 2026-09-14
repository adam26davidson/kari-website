import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_OVERRIDES,
  PREVIEW_READY,
  PreviewOverrides,
} from "@kari/shared/utils/preview-channel";
import { PREVIEW_FRAME_TITLE, SitePreview } from "./site-preview";

const homePage = { photo: "kari.jpg", blurb: "draft words", photoFile: null };
const overrides: PreviewOverrides = { homePage };

const renderPreview = (value: PreviewOverrides = overrides) =>
  render(
    <SitePreview
      path="/"
      description="This is how your home page will look."
      overrides={value}
    />,
  );

const frame = () =>
  screen.getByTitle(PREVIEW_FRAME_TITLE) as HTMLIFrameElement;

/** The box whose width decides how far the frame is scaled down. */
const stage = () => frame().parentElement!.parentElement!;

/**
 * The frame's ready signal, as the framed site's own postMessage would
 * deliver it.
 *
 * Constructed by hand rather than called through `postMessage`, because
 * jsdom delivers its own postMessage with `origin: ""` — which the
 * component's same-origin check rejects, correctly, so a test using the
 * real API could only ever exercise the rejection.
 */
function announceReady({
  origin = window.location.origin,
  source = frame().contentWindow,
  data = { type: PREVIEW_READY } as unknown,
} = {}) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
  });
}

describe("SitePreview's frame and links", () => {
  it("frames the public path in preview mode", () => {
    renderPreview();
    expect(frame().getAttribute("src")).toBe("/?preview=1");
  });

  it("says in plain words what the pane is showing", () => {
    renderPreview();
    expect(screen.getByText("See it on your site")).toBeInTheDocument();
    expect(
      screen.getByText("This is how your home page will look."),
    ).toBeInTheDocument();
  });

  it("opens the LIVE page in a new tab, without her unsaved edits", () => {
    renderPreview();
    const link = screen.getByRole("link", { name: /Open in a new tab/ });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("SitePreview's handshake", () => {
  let post: ReturnType<typeof vi.fn>;

  const spyOnFrame = () => {
    post = vi.fn();
    Object.defineProperty(frame(), "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });
  };

  it("sends the current form state when the frame says it is ready", () => {
    renderPreview();
    spyOnFrame();

    announceReady();

    expect(post).toHaveBeenCalledWith(
      { type: PREVIEW_OVERRIDES, overrides },
      window.location.origin,
    );
  });

  it("ignores a ready signal from another origin", () => {
    renderPreview();
    spyOnFrame();

    announceReady({ origin: "https://evil.example" });

    expect(post).not.toHaveBeenCalled();
  });

  it("ignores a ready signal from a window that is not its frame", () => {
    renderPreview();
    spyOnFrame();

    announceReady({ source: window });

    expect(post).not.toHaveBeenCalled();
  });

  it("ignores same-origin chatter that is not the ready signal", () => {
    renderPreview();
    spyOnFrame();

    // vite's HMR client posts into this window too.
    announceReady({ data: { type: "vite:beforeUpdate" } });
    announceReady({ data: "hello" });

    expect(post).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    renderPreview().unmount();
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
  });
});

describe("SitePreview's live updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-sends the form state after she stops typing", () => {
    const { rerender } = renderPreview();
    const post = vi.fn();
    Object.defineProperty(frame(), "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });
    act(() => {
      vi.runAllTimers();
    });
    post.mockClear();

    const typed = { homePage: { ...homePage, blurb: "draft wordsy" } };
    rerender(
      <SitePreview path="/" description="desc" overrides={typed} />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(post).toHaveBeenCalledWith(
      { type: PREVIEW_OVERRIDES, overrides: typed },
      window.location.origin,
    );
  });

  it("sends once for a burst of keystrokes, not once per character", () => {
    const { rerender } = renderPreview();
    const post = vi.fn();
    Object.defineProperty(frame(), "contentWindow", {
      value: { postMessage: post },
      configurable: true,
    });
    act(() => {
      vi.runAllTimers();
    });
    post.mockClear();

    for (const blurb of ["a", "ab", "abc"]) {
      rerender(
        <SitePreview
          path="/"
          description="desc"
          overrides={{ homePage: { ...homePage, blurb } }}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(post).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].overrides.homePage.blurb).toBe("abc");
  });
});

describe("SitePreview's width toggle", () => {
  it("starts on Computer, at a real computer's width", () => {
    renderPreview();
    expect(
      screen.getByRole("button", { name: "Computer" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(frame().style.width).toBe("1280px");
  });

  it("switches to a phone's width without remounting the frame", async () => {
    renderPreview();
    const before = frame();

    await userEvent.click(screen.getByRole("button", { name: "Phone" }));

    // Identity, not just width: a remount would restart the handshake and
    // blank the draft she is looking at.
    expect(frame()).toBe(before);
    expect(frame().style.width).toBe("390px");
    expect(screen.getByRole("button", { name: "Phone" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders unscaled when the container has not been laid out", () => {
    // jsdom does no layout, so clientWidth is 0 everywhere.
    renderPreview();
    expect(frame().style.transform).toBe("scale(1)");
  });

  it("shrinks the frame to fit a container narrower than the device", () => {
    renderPreview();
    Object.defineProperty(stage(), "clientWidth", {
      value: 640,
      configurable: true,
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    // 640/1280: the full desktop layout, at half size, inside the card.
    expect(frame().style.transform).toBe("scale(0.5)");
    expect(stage().firstElementChild).toHaveStyle({
      width: "640px",
      height: "400px",
    });
  });

  it("never scales a frame UP to fill a wide container", () => {
    renderPreview();
    Object.defineProperty(stage(), "clientWidth", {
      value: 2000,
      configurable: true,
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(frame().style.transform).toBe("scale(1)");
  });
});
