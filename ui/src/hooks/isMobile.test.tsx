import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIsMobile } from "./isMobile";

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function resizeTo(width: number) {
  act(() => {
    setWindowWidth(width);
    window.dispatchEvent(new Event("resize"));
  });
}

describe("useIsMobile", () => {
  it("is true when the window starts narrower than the breakpoint", () => {
    setWindowWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("is false when the window starts at or above the breakpoint", () => {
    setWindowWidth(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("updates when the window is resized across the breakpoint", () => {
    setWindowWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    resizeTo(400);
    expect(result.current).toBe(true);

    resizeTo(900);
    expect(result.current).toBe(false);
  });

  it("respects a custom breakpoint", () => {
    setWindowWidth(900);
    const { result } = renderHook(() => useIsMobile(1000));
    expect(result.current).toBe(true);

    resizeTo(1100);
    expect(result.current).toBe(false);
  });

  it("stops listening for resizes after unmount", () => {
    setWindowWidth(1024);
    const { result, unmount } = renderHook(() => useIsMobile());
    unmount();

    resizeTo(400);
    expect(result.current).toBe(false);
  });
});
