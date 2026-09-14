import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useObjectUrl } from "./use-object-url";

const aFile = (name: string) => new File(["pixels"], name);

describe("useObjectUrl", () => {
  it("returns null when there is no file", () => {
    const { result } = renderHook(() => useObjectUrl(null));
    expect(result.current).toBeNull();
  });

  it("creates an object URL for a file", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");

    const file = aFile("kari.png");
    const { result } = renderHook(() => useObjectUrl(file));

    expect(result.current).toBe("blob:one");
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });

  it("revokes the old URL and creates a new one when the file changes", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    const { result, rerender } = renderHook(
      ({ file }: { file: File | null }) => useObjectUrl(file),
      { initialProps: { file: aFile("first.png") } },
    );
    rerender({ file: aFile("second.png") });

    expect(revoke).toHaveBeenCalledWith("blob:one");
    expect(result.current).toBe("blob:two");
  });

  it("drops back to null, revoking, when the file is cleared", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    const { result, rerender } = renderHook(
      ({ file }: { file: File | null }) => useObjectUrl(file),
      { initialProps: { file: aFile("kari.png") } as { file: File | null } },
    );
    rerender({ file: null });

    expect(revoke).toHaveBeenCalledWith("blob:one");
    expect(result.current).toBeNull();
  });

  it("revokes the URL on unmount", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    const { unmount } = renderHook(() => useObjectUrl(aFile("kari.png")));
    unmount();

    expect(revoke).toHaveBeenCalledWith("blob:one");
  });
});
