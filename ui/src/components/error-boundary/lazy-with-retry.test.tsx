import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { ErrorBoundary } from "./error-boundary";
import {
  CHUNK_RELOAD_FLAG,
  isChunkLoadError,
  lazyWithRetry,
} from "./lazy-with-retry";

function Page() {
  return <p>page loaded</p>;
}

// What Chrome throws when a hashed chunk URL 404s after a redeploy.
function chunkError() {
  return new TypeError(
    "Failed to fetch dynamically imported module: " +
      "https://example.test/assets/HaikuPage-a1b2c3.js",
  );
}

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    map,
  };
}

function renderLazy(component: ReturnType<typeof lazyWithRetry>) {
  const Component = component;
  return render(
    <ErrorBoundary>
      <Suspense fallback={<p>loading chunk</p>}>
        <Component />
      </Suspense>
    </ErrorBoundary>,
  );
}

beforeEach(() => {
  // React and the boundary both log caught errors; keep output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("isChunkLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://x/a.js",
    "error loading dynamically imported module",
    "Importing a module script failed.",
    "Loading chunk 5 failed",
  ])("recognizes browser chunk-load message %#", (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("rejects generic errors and non-errors", () => {
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError(new TypeError("x is not a function"))).toBe(false);
    expect(isChunkLoadError("dynamically imported module")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("lazyWithRetry", () => {
  it("renders the component when the import succeeds first try", async () => {
    const factory = vi.fn().mockResolvedValue({ default: Page });
    renderLazy(lazyWithRetry(factory));
    expect(await screen.findByText("page loaded")).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("re-attempts a failed import and recovers when the retry succeeds", async () => {
    const reload = vi.fn();
    const factory = vi
      .fn()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValue({ default: Page });
    renderLazy(lazyWithRetry(factory, { reload, storage: fakeStorage() }));

    expect(await screen.findByText("page loaded")).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears the reload flag after a successful load", async () => {
    const storage = fakeStorage({ [CHUNK_RELOAD_FLAG]: "1" });
    const factory = vi.fn().mockResolvedValue({ default: Page });
    renderLazy(lazyWithRetry(factory, { reload: vi.fn(), storage }));

    expect(await screen.findByText("page loaded")).toBeInTheDocument();
    expect(storage.map.has(CHUNK_RELOAD_FLAG)).toBe(false);
  });

  it("auto-reloads once — and only once — when the chunk keeps failing", async () => {
    const reload = vi.fn();
    const storage = fakeStorage();
    const factory = vi.fn().mockRejectedValue(chunkError());
    renderLazy(lazyWithRetry(factory, { reload, storage }));

    // First failure: sets the flag and reloads instead of erroring out.
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(storage.map.get(CHUNK_RELOAD_FLAG)).toBe("1");
    // The loader never settles, so Suspense keeps its fallback up
    // while the (mocked) reload happens — no error flash.
    expect(screen.getByText("loading chunk")).toBeInTheDocument();

    // Simulate the reloaded page hitting the same failure: same
    // sessionStorage (it survives reloads), fresh component instance.
    renderLazy(lazyWithRetry(factory, { reload, storage }));
    expect(
      await screen.findByText(
        "A new version of the site may have been deployed — " +
          "reload to get the latest.",
      ),
    ).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not auto-reload when the flag is already set", async () => {
    const reload = vi.fn();
    const storage = fakeStorage({ [CHUNK_RELOAD_FLAG]: "1" });
    const factory = vi.fn().mockRejectedValue(chunkError());
    renderLazy(lazyWithRetry(factory, { reload, storage }));

    expect(
      await screen.findByText(/A new version of the site/),
    ).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not auto-reload for non-chunk import failures", async () => {
    const reload = vi.fn();
    const storage = fakeStorage();
    const factory = vi
      .fn()
      .mockRejectedValue(new Error("module evaluation exploded"));
    renderLazy(lazyWithRetry(factory, { reload, storage }));

    expect(
      await screen.findByText("Something went wrong displaying this page."),
    ).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(storage.map.has(CHUNK_RELOAD_FLAG)).toBe(false);
  });

  it("never auto-reloads when storage is unavailable", async () => {
    const reload = vi.fn();
    const factory = vi.fn().mockRejectedValue(chunkError());
    renderLazy(lazyWithRetry(factory, { reload, storage: null }));

    expect(
      await screen.findByText(/A new version of the site/),
    ).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
