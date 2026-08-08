import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import HaikuZenViewer from "./haikuZenviewer";

const haikuList = [
  ["an old pond", "a frog jumps in", "the sound of water"],
  ["winter moon", "shadows on the snow"],
];

function lines(container: HTMLElement): Array<HTMLElement> {
  return Array.from(container.querySelectorAll(".haiku-zen-line"));
}

function opacities(container: HTMLElement): Array<string> {
  return lines(container).map((line) => line.style.opacity);
}

function nextArrow(container: HTMLElement): HTMLElement {
  const arrow = container.querySelector(".next-haiku-zen");
  if (!(arrow instanceof HTMLElement)) {
    throw new Error("no next arrow");
  }
  return arrow;
}

// Advance the fake clock inside act so the state updates the fired
// timers cause are flushed into the DOM.
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HaikuZenViewer", () => {
  it("reveals the lines one at a time, two seconds apart", () => {
    const { container } = render(<HaikuZenViewer haikuList={haikuList} />);

    // All lines are rendered from the start, but hidden.
    expect(lines(container).map((line) => line.textContent)).toEqual(
      haikuList[0],
    );
    expect(opacities(container)).toEqual(["0", "0", "0"]);

    // The first line's timer fires at 0ms.
    advance(0);
    expect(opacities(container)).toEqual(["1", "0", "0"]);

    advance(2000);
    expect(opacities(container)).toEqual(["1", "1", "0"]);

    advance(2000);
    expect(opacities(container)).toEqual(["1", "1", "1"]);
  });

  it("shows the next-arrow only after every line has appeared", () => {
    const { container } = render(<HaikuZenViewer haikuList={haikuList} />);

    // One tick before lines.length * 2000ms the arrow is still hidden...
    advance(5999);
    expect(nextArrow(container).style.opacity).toBe("0");

    // ...and at exactly 3 * 2000ms it appears.
    advance(1);
    expect(nextArrow(container).style.opacity).toBe("1");
  });

  it("fades out on next, then shows the following haiku from hidden", () => {
    const { container } = render(<HaikuZenViewer haikuList={haikuList} />);
    advance(6000);

    fireEvent.click(nextArrow(container));

    // Fade-out: still the first haiku's text, but everything hidden.
    expect(lines(container).map((line) => line.textContent)).toEqual(
      haikuList[0],
    );
    expect(opacities(container)).toEqual(["0", "0", "0"]);
    expect(nextArrow(container).style.opacity).toBe("0");

    // After the 2000ms fade the second haiku shows, lines hidden again.
    advance(2000);
    expect(lines(container).map((line) => line.textContent)).toEqual(
      haikuList[1],
    );
    expect(opacities(container)).toEqual(["0", "0"]);
    expect(nextArrow(container).style.opacity).toBe("0");

    // Its lines then reveal on the same two-second cadence.
    advance(0);
    expect(opacities(container)).toEqual(["1", "0"]);
    advance(2000);
    expect(opacities(container)).toEqual(["1", "1"]);
    advance(2000);
    expect(nextArrow(container).style.opacity).toBe("1");
  });

  it("wraps back to the first haiku at the end of the list", () => {
    const { container } = render(<HaikuZenViewer haikuList={haikuList} />);

    // Advance through the first haiku and on to the second.
    advance(6000);
    fireEvent.click(nextArrow(container));
    advance(2000);
    expect(lines(container).map((line) => line.textContent)).toEqual(
      haikuList[1],
    );

    // The second is the last: next wraps around to the first.
    advance(4000);
    fireEvent.click(nextArrow(container));
    advance(2000);
    expect(lines(container).map((line) => line.textContent)).toEqual(
      haikuList[0],
    );
    expect(opacities(container)).toEqual(["0", "0", "0"]);
  });

  it("clears its timers on unmount", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { unmount } = render(<HaikuZenViewer haikuList={haikuList} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    // The effect cleanup cleared every pending reveal timer, so nothing
    // fires (and nothing tries to update unmounted state) afterwards.
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.runAllTimers();
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
