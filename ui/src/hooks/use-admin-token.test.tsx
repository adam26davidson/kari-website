import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAdminToken } from "./use-admin-token";

const getAccessTokenSilently = vi.fn();
const loginWithRedirect = vi.fn();

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({ getAccessTokenSilently, loginWithRedirect }),
}));

beforeEach(() => {
  // Re-establish each test: the global afterEach runs vi.restoreAllMocks().
  getAccessTokenSilently.mockReset();
  loginWithRedirect.mockReset();
  loginWithRedirect.mockResolvedValue(undefined);
});

describe("use-admin-token", () => {
  it("returns the token when the Auth0 session is valid", async () => {
    getAccessTokenSilently.mockResolvedValue("a-token");

    const { result } = renderHook(() => useAdminToken());

    await expect(result.current()).resolves.toBe("a-token");
    expect(loginWithRedirect).not.toHaveBeenCalled();
  });

  it("redirects to login and throws when the session is invalid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getAccessTokenSilently.mockRejectedValue(new Error("expired"));

    const { result } = renderHook(() => useAdminToken());

    await expect(result.current()).rejects.toThrow(
      "Session expired — redirecting to login",
    );
    expect(loginWithRedirect).toHaveBeenCalledOnce();
  });

  it("returns a stable callback across re-renders", () => {
    const { result, rerender } = renderHook(() => useAdminToken());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
