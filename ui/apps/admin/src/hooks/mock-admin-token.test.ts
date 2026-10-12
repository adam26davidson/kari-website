import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { mockAdminGetToken, useAdminToken } from "./mock-admin-token";

// The double is only useful if it keeps the real hook's contract (pinned in
// use-admin-token.test.tsx): one getter for the life of the test, so effects
// keyed on it don't re-run every render (#876).
describe("mock useAdminToken", () => {
  it("returns the same getter across re-renders", () => {
    const { result, rerender } = renderHook(() => useAdminToken());
    rerender();
    expect(result.current).toBe(mockAdminGetToken);
  });

  it("resolves a token, even after the global mock reset", async () => {
    // A previous test's afterEach has run vi.resetAllMocks() by now; the
    // implementation passed to vi.fn must survive it.
    await expect(mockAdminGetToken()).resolves.toBe("token");
  });
});
