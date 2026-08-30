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
  vi.restoreAllMocks();
});
