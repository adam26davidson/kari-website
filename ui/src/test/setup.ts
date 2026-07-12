// Global test setup: adds jest-dom matchers (toBeInTheDocument, etc.) and
// resets any per-test mocks/spies between tests.
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
