import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { Header } from "./header";
import { PAGES } from "../../constants";
import { useIsMobile } from "../../hooks/use-is-mobile";

vi.mock("../../hooks/use-is-mobile", () => ({
  useIsMobile: vi.fn(),
}));

// The header's only Auth0 consumer is HeaderUserSection, which it pulls in
// through a lazy chunk (see auth/lazy-admin-auth.ts). Stubbing the module
// behind that chunk keeps @auth0/auth0-react out of this file entirely --
// which is the point: a header that reached for Auth0 directly would throw
// "You forgot to wrap your component in <Auth0Provider>" in every
// public-route test below, since public pages mount no provider.
vi.mock("../../auth/admin-auth", () => ({
  AdminAuthProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  HeaderUserSection: () => <div>User section stub</div>,
}));

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

  it("does not render the hamburger menu button", () => {
    renderHeader("/");
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
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
    const { setShowingMobileMenu } = renderHeader("/", {
      showingMobileMenu: false,
    });
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(setShowingMobileMenu).toHaveBeenCalledWith(true);
  });

  it("toggles the mobile menu closed when it is already open", async () => {
    const { setShowingMobileMenu } = renderHeader("/", {
      showingMobileMenu: true,
    });
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(setShowingMobileMenu).toHaveBeenCalledWith(false);
  });

  it("toggles the mobile menu with the keyboard", async () => {
    const { setShowingMobileMenu } = renderHeader("/", {
      showingMobileMenu: false,
    });
    const button = screen.getByRole("button", { name: "Menu" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(setShowingMobileMenu).toHaveBeenCalledWith(true);
  });
});

describe("Header on /admin", () => {
  it("shows the admin title and the signed-in user section", async () => {
    renderHeader("/admin");
    expect(screen.getByText("Kari Davidson - Admin")).toBeInTheDocument();
    expect(await screen.findByText("User section stub")).toBeInTheDocument();
  });

  it("shows the admin header on nested admin routes", async () => {
    renderHeader("/admin/haiku/h1");
    expect(screen.getByText("Kari Davidson - Admin")).toBeInTheDocument();
    expect(await screen.findByText("User section stub")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("Header on public routes", () => {
  it("never mounts the Auth0-backed user section", async () => {
    renderHeader("/haiku");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("User section stub")).toBeNull();
  });
});
