// Global test setup: adds jest-dom matchers (toBeInTheDocument, etc.) and
// resets any per-test mocks/spies between tests.
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom implements neither object-URL function; browsers have both. Polyfill
// them once here so components (e.g. PhotoPicker) can call them plainly and
// tests can override behavior with vi.spyOn — which vi.restoreAllMocks()
// below undoes, so a spy never leaks into another test file's run.
if (typeof window.URL.createObjectURL !== "function") {
  window.URL.createObjectURL = () => "blob:jsdom-object-url";
}
if (typeof window.URL.revokeObjectURL !== "function") {
  window.URL.revokeObjectURL = () => {};
}

// jsdom implements no geometry on Range at all, and ProseMirror's
// scrollToSelection measures the caret through one (prosemirror-view's
// coordsAtPos -> singleRect(textRange(...))). Every editor command that ends
// in focus() reaches it, so without these the tiptap tests die on
// "target.getClientRects is not a function" as an uncaught exception rather
// than a test failure. jsdom does no layout, so zeroes are the honest answer;
// ProseMirror treats a zero rect as "nothing to scroll to" and moves on.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () =>
    Object.assign([] as DOMRect[], {
      item: () => null,
    }) as unknown as DOMRectList;
}
if (typeof Range.prototype.getBoundingClientRect !== "function") {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

// react-router's data router (createMemoryRouter in tests) constructs a
// Request carrying jsdom's AbortSignal, which Node's undici Request rejects
// with a brand check jsdom's implementation can't satisfy. Nothing in the
// app consumes request signals (no route loaders, no fetch aborts), so
// drop them rather than bridge them. Remove once jsdom and undici share
// AbortSignal (jsdom#3524).
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.signal) {
      init = { ...init, signal: undefined };
    }
    super(input, init);
  }
};

afterEach(() => {
  cleanup();
  // Both calls are needed, and neither replaces the other (#529).
  //
  // Up to vitest 2, restoreAllMocks() called mockRestore() on every
  // registered mock, so it doubled as the reset for the plain vi.fn()s that
  // vi.mock factories are built from. vitest 3 narrowed it: it now only
  // walks the spies vi.spyOn registered, and a vi.fn() keeps its call
  // history and implementation for the rest of the file. That silently
  // leaks state between tests -- call counts accumulate, and a
  // mockResolvedValue set in one test still answers in the next.
  //
  // resetAllMocks() is the half that covers those: it calls mockReset() on
  // every registered mock, clearing calls and implementations alike.
  // restoreAllMocks() is still the half that un-spies vi.spyOn, which the
  // object-URL polyfill above depends on.
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
