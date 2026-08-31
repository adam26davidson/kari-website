import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useS3Load } from "./use-s3-load";

describe("use-s3-load", () => {
  beforeEach(() => {
    // The failure path logs via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("starts loading with the initial data", () => {
    // The fetch never settles, freezing the hook in its initial state.
    const fetcher = vi.fn(() => new Promise<string>(() => {}));

    const { result } = renderHook(() => useS3Load(fetcher, "initial"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.data).toBe("initial");
  });

  it("exposes the fetched data once the fetch resolves", async () => {
    const fetcher = vi.fn().mockResolvedValue(["a", "b"]);

    const { result } = renderHook(() => useS3Load(fetcher, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(["a", "b"]);
    expect(result.current.loadFailed).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("flags the failure and keeps the initial data on a rejected fetch", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useS3Load(fetcher, "initial"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Failed loads must surface as loadFailed, never as fallback data
    // masquerading as real content.
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.data).toBe("initial");
  });

  it("recovers when load() is retried after a failure", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue("loaded");

    const { result } = renderHook(() => useS3Load(fetcher, "initial"));
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    await act(() => result.current.load());

    expect(result.current.loadFailed).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBe("loaded");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not refetch on rerender with the same fetcher", async () => {
    const fetcher = vi.fn().mockResolvedValue("loaded");

    const { result, rerender } = renderHook(() => useS3Load(fetcher, ""));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
