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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
