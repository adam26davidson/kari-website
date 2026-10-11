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

  it("never answers a new list with the previous list's URLs", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");
    const seen: Array<Array<string | null>> = [];

    const { rerender } = renderHook(
      ({ files }: { files: Array<File | null> }) => {
        const urls = useObjectUrls(files);
        seen.push(urls);
        return urls;
      },
      {
        initialProps: { files: [aFile("a.png")] } as {
          files: Array<File | null>;
        },
      },
    );
    seen.length = 0;
    rerender({ files: [null, aFile("b.png")] });

    expect(seen).not.toContainEqual(["blob:one"]);
    expect(seen.at(-1)).toEqual([null, "blob:two"]);
  });

  it("keeps its URLs across re-renders with the same list", () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");

    const files = [aFile("a.png")];
    const { rerender } = renderHook(() => useObjectUrls(files));
    rerender();

    expect(create).toHaveBeenCalledOnce();
  });

  // The preview receives its draft by postMessage, which structured-clones
  // it: every debounced send delivers NEW File objects for the same photos.
  const cloneOf = (file: File) =>
    new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });

  it("keeps a file's URL, on every render, when a clone of it arrives in a new list", () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const seen: Array<Array<string | null>> = [];
    const a = aFile("a.png");

    const { rerender } = renderHook(
      ({ files }: { files: Array<File | null> }) => {
        const urls = useObjectUrls(files);
        seen.push(urls);
        return urls;
      },
      { initialProps: { files: [a, null] } as { files: Array<File | null> } },
    );
    seen.length = 0;
    rerender({ files: [cloneOf(a), null] });

    expect(seen.length).toBeGreaterThan(0);
    for (const urls of seen) expect(urls).toEqual(["blob:one", null]);
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("moves each URL with its file when the rows are reordered", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");
    const seen: Array<Array<string | null>> = [];
    const a = aFile("a.png");
    const b = aFile("b.png");

    const { rerender } = renderHook(
      ({ files }: { files: Array<File | null> }) => {
        const urls = useObjectUrls(files);
        seen.push(urls);
        return urls;
      },
      { initialProps: { files: [a, b] } as { files: Array<File | null> } },
    );
    seen.length = 0;
    rerender({ files: [cloneOf(b), cloneOf(a)] });

    for (const urls of seen) expect(urls).toEqual(["blob:two", "blob:one"]);
  });

  it("revokes only the URLs whose files have left the list", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two")
      .mockReturnValueOnce("blob:three");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const a = aFile("a.png");

    const { result, rerender } = renderHook(
      ({ files }: { files: Array<File | null> }) => useObjectUrls(files),
      {
        initialProps: { files: [a, aFile("b.png")] } as {
          files: Array<File | null>;
        },
      },
    );
    rerender({ files: [cloneOf(a), aFile("c.png")] });

    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:two");
    expect(result.current).toEqual(["blob:one", "blob:three"]);
  });

  it("gives one URL to a file that appears in two rows", () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one");
    const a = aFile("a.png");

    const files = [a, cloneOf(a)];
    const { result } = renderHook(() => useObjectUrls(files));

    expect(result.current).toEqual(["blob:one", "blob:one"]);
    expect(create).toHaveBeenCalledOnce();
  });

  it("never leaves a revoked URL in use under StrictMode", () => {
    let made = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++made}`);
    const revoked = new Set<string>();
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.add(url);
    });

    const files = [aFile("a.png")];
    const { result } = renderHook(() => useObjectUrls(files), {
      reactStrictMode: true,
    });

    const [url] = result.current;
    expect(url).not.toBeNull();
    expect(revoked.has(url as string)).toBe(false);
  });
});
