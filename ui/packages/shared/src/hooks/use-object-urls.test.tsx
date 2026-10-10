import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useObjectUrls } from "./use-object-urls";

const aFile = (name: string) => new File(["pixels"], name);

describe("useObjectUrls", () => {
  it("returns one URL per file and null for each null", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");

    const files = [aFile("a.png"), null, aFile("b.png")];
    const { result } = renderHook(() => useObjectUrls(files));

    expect(result.current).toEqual(["blob:one", null, "blob:two"]);
  });

  it("returns an empty list for no files", () => {
    const files: Array<File | null> = [];
    const { result } = renderHook(() => useObjectUrls(files));
    expect(result.current).toEqual([]);
  });

  it("revokes every URL and makes new ones when the list changes", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two")
      .mockReturnValueOnce("blob:three");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    const { result, rerender } = renderHook(
      ({ files }: { files: Array<File | null> }) => useObjectUrls(files),
      { initialProps: { files: [aFile("a.png"), aFile("b.png"), null] } },
    );
    rerender({ files: [aFile("c.png")] });

    expect(revoke).toHaveBeenCalledWith("blob:one");
    expect(revoke).toHaveBeenCalledWith("blob:two");
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(["blob:three"]);
  });

  it("revokes every URL on unmount", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    const files = [aFile("a.png"), aFile("b.png")];
    const { unmount } = renderHook(() => useObjectUrls(files));
    unmount();

    expect(revoke).toHaveBeenCalledWith("blob:one");
    expect(revoke).toHaveBeenCalledWith("blob:two");
  });

  it("keeps its URLs across re-renders with the same list", () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:one");

    const files = [aFile("a.png")];
    const { rerender } = renderHook(() => useObjectUrls(files));
    rerender();

    expect(create).toHaveBeenCalledOnce();
  });
});
