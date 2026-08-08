import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Header from "./header";
import { PAGES } from "../../constants";
import { useIsMobile } from "../../hooks/isMobile";
import { useAuth0 } from "@auth0/auth0-react";

vi.mock("../../hooks/isMobile", () => ({
  useIsMobile: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: vi.fn(),
}));

const logout = vi.fn();

function mockAuth0(overrides = {}) {
  vi.mocked(useAuth0).mockReturnValue({
    user: undefined,
    isAuthenticated: false,
    isLoading: false,
    logout,
    ...overrides,
  } as unknown as ReturnType<typeof useAuth0>);
}

function renderHeader(
  path: string,
  {
    showingMobileMenu = false,
    setShowingMobileMenu = vi.fn(),
  }: {
    showingMobileMenu?: boolean;
    setShowingMobileMenu?: (showing: boolean) => void;
  } = {},
) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Header
        showingMobileMenu={showingMobileMenu}
        setShowingMobileMenu={setShowingMobileMenu}
      />
    </MemoryRouter>,
  );
  return { container: view.container, setShowingMobileMenu };
}

beforeEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false);
  mockAuth0();
});

describe("Header on desktop, non-admin routes", () => {
  it("shows the site title without the admin suffix", () => {
    renderHeader("/");
    expect(screen.getByText("Kari Davidson")).toBeInTheDocument();
    expect(screen.queryByText(/- Admin/)).not.toBeInTheDocument();
  });

  it("renders a nav link per page and marks the current one active", () => {
    renderHeader("/haiku");
    for (const page of PAGES) {
      const link = screen.getByRole("link", { name: page.name });
      expect(link).toHaveAttribute("href", page.path);
    }
    expect(screen.getByRole("link", { name: "Haiku" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Haiga" })).not.toHaveClass(
      "active",
    );
  });

  it("does not render the hamburger menu icon", () => {
    const { container } = renderHeader("/");
    expect(
      container.querySelector(".header-menu-icon"),
    ).not.toBeInTheDocument();
  });
});

describe("Header on mobile", () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(true);
  });

  it("hides the nav links", () => {
    renderHeader("/");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("toggles the mobile menu open when the hamburger is clicked", async () => {
    const { container, setShowingMobileMenu } = renderHeader("/", {
      showingMobileMenu: false,
    });
    const icon = container.querySelector(".header-menu-icon");
    expect(icon).toBeInTheDocument();
    await userEvent.click(icon as Element);
    expect(setShowingMobileMenu).toHaveBeenCalledWith(true);
  });

  it("toggles the mobile menu closed when it is already open", async () => {
    const { container, setShowingMobileMenu } = renderHeader("/", {
      showingMobileMenu: true,
    });
    await userEvent.click(
      container.querySelector(".header-menu-icon") as Element,
    );
    expect(setShowingMobileMenu).toHaveBeenCalledWith(false);
  });
});

describe("Header on /admin", () => {
  it("shows the admin title, user name, and a working logout button", async () => {
    mockAuth0({
      user: { name: "Kari" },
      isAuthenticated: true,
    });
    renderHeader("/admin");
    expect(screen.getByText("Kari Davidson - Admin")).toBeInTheDocument();
    expect(screen.getByText("Kari")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button"));
    expect(logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
  });

  it("shows a logging-in message while Auth0 is loading", () => {
    mockAuth0({ isLoading: true });
    renderHeader("/admin");
    expect(screen.getByText("Logging in...")).toBeInTheDocument();
  });
});
