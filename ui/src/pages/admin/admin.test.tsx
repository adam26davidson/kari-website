import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Admin from "./admin";
import { useAuth0 } from "@auth0/auth0-react";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: vi.fn(),
}));

// The sub-pages have their own tests; stub them so this file exercises
// only the shell: auth gating, the menu, and page switching.
vi.mock("./homePageEditor/homePageEditor", () => ({
  HomePageEditor: () => <div>home-page-stub</div>,
}));
vi.mock("./adminHaikuPage/adminHaikuPage", () => ({
  default: () => <div>haiku-page-stub</div>,
}));
vi.mock("./adminHaigaPage/adminHaigaPage", () => ({
  default: () => <div>haiga-page-stub</div>,
}));
vi.mock("./adminOtherWorksPage/admin-other-works-page", () => ({
  AdminOtherWorksPage: () => <div>other-works-page-stub</div>,
}));
vi.mock("./admin-photography-page/admin-photography-page", () => ({
  AdminPhotographyPage: () => <div>photography-page-stub</div>,
}));
vi.mock("./admin-image-gc-page/admin-image-gc-page", () => ({
  AdminImageGcPage: () => <div>image-gc-page-stub</div>,
}));

const loginWithRedirect = vi.fn();

function mockAuth(overrides?: {
  isAuthenticated?: boolean;
  isLoading?: boolean;
}) {
  vi.mocked(useAuth0).mockReturnValue({
    isAuthenticated: overrides?.isAuthenticated ?? true,
    isLoading: overrides?.isLoading ?? false,
    loginWithRedirect,
  } as unknown as ReturnType<typeof useAuth0>);
}

beforeEach(() => {
  mockAuth();
});

describe("Admin authentication gating", () => {
  it("offers login when unauthenticated", () => {
    mockAuth({ isAuthenticated: false });
    render(<Admin />);

    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    expect(loginWithRedirect).toHaveBeenCalledOnce();
    expect(screen.queryByText("Home")).toBeNull();
  });

  it("shows neither login nor menu while auth is loading", () => {
    mockAuth({ isAuthenticated: false, isLoading: true });
    render(<Admin />);

    expect(screen.queryByRole("button", { name: "Log In" })).toBeNull();
    expect(screen.queryByText("Home")).toBeNull();
  });
});

describe("Admin menu", () => {
  it("lists every admin page with its label, in order", () => {
    render(<Admin />);

    const labels = Array.from(
      document.querySelectorAll(".admin-menu-item"),
    ).map((item) => item.textContent);
    expect(labels).toEqual([
      "Home",
      "Haiku",
      "Haiga",
      "Photography",
      "Other works",
      "Image cleanup",
    ]);
  });

  it("starts on the home page editor", () => {
    render(<Admin />);
    expect(screen.getByText("home-page-stub")).toBeInTheDocument();
    expect(screen.getByText("Home")).toHaveClass("selected");
  });

  it.each([
    ["Haiku", "haiku-page-stub"],
    ["Haiga", "haiga-page-stub"],
    ["Photography", "photography-page-stub"],
    ["Other works", "other-works-page-stub"],
    ["Image cleanup", "image-gc-page-stub"],
  ])("switches to %s on click", (label, stub) => {
    render(<Admin />);

    fireEvent.click(screen.getByText(label));

    expect(screen.getByText(stub)).toBeInTheDocument();
    expect(screen.getByText(label)).toHaveClass("selected");
    expect(screen.queryByText("home-page-stub")).toBeNull();
  });
});
