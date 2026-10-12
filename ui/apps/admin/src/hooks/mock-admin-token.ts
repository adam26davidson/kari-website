import { vi } from "vitest";

/**
 * Test double for `./use-admin-token`. Mock the hook in a test file with:
 *
 *   vi.mock("../hooks/use-admin-token", () =>
 *     import("../hooks/mock-admin-token"),
 *   );
 *
 * It honours the real hook's contract: every call returns the SAME getter,
 * so effects keyed on it run once, as they do in the app. A mock written as
 * `useAdminToken: () => async () => "token"` hands back a fresh function on
 * every render instead, and any effect with the getter in its dependencies
 * (the assistant's availability check, for one) re-runs each render until
 * the test times out (#876).
 *
 * This module must not import the hook it replaces (directly or through
 * another helper): the factory above loads it while the mocked module is
 * being resolved, so a cycle would hand the factory an uninitialised module.
 */

/** The one getter every `useAdminToken()` call returns. Resolves "token". */
export const mockAdminGetToken = vi.fn(async () => "token");

export function useAdminToken() {
  return mockAdminGetToken;
}
