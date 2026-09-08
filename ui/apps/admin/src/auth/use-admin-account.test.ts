import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuth0 } from "@auth0/auth0-react";
import { useAdminAccount } from "./use-admin-account";

vi.mock("@auth0/auth0-react", () => ({ useAuth0: vi.fn() }));

const logout = vi.fn();

function mockAuth0(user?: { name?: string }) {
  vi.mocked(useAuth0).mockReturnValue({
    user,
    logout,
  } as unknown as ReturnType<typeof useAuth0>);
}

beforeEach(() => {
  mockAuth0({ name: "Kari" });
});

describe("useAdminAccount", () => {
  it("reports the signed-in name and its initial", () => {
    const { result } = renderHook(() => useAdminAccount());
    expect(result.current.name).toBe("Kari");
    expect(result.current.initial).toBe("K");
  });

  // An Auth0 account with no display name set reports its EMAIL as `name`,
  // which is what overflowed the old admin bar (#573). The sidebar shows
  // it truncated, so the hook must hand it over whole rather than deciding
  // how much of it fits.
  it("passes a long name through untouched", () => {
    const email = "kari.davidson@example.com";
    mockAuth0({ name: email });
    const { result } = renderHook(() => useAdminAccount());
    expect(result.current.name).toBe(email);
    expect(result.current.initial).toBe("K");
  });

  it("uppercases the initial", () => {
    mockAuth0({ name: "kari" });
    expect(renderHook(() => useAdminAccount()).result.current.initial).toBe("K");
  });

  // The shell renders before Auth0 has a profile, and again for the split
  // second after a sign-out. Neither may throw, and neither may put the
  // word "undefined" in the sidebar.
  it.each([
    ["no user at all", undefined],
    ["a user with no name", {}],
    ["a blank name", { name: "   " }],
  ])("stays empty for %s", (_case, user) => {
    mockAuth0(user);
    const { result } = renderHook(() => useAdminAccount());
    expect(result.current.initial).toBe("");
  });

  it("signs out back to this origin", () => {
    renderHook(() => useAdminAccount()).result.current.signOut();
    expect(logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });
});
