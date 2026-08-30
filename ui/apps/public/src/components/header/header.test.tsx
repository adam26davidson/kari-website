import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Header } from "./header";
import { PAGES } from "@kari/shared/constants";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";

vi.mock("@kari/shared/hooks/use-is-mobile", () => ({
  useIsMobile: vi.fn(),
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

describe("Header on desktop", () => {
  it("shows the site title", () => {
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

  // The admin section is a separate application (#591): its own build, its
  // own bundle, mounted under /admin. A router <Link> would try to resolve
  // that inside this app's route tree, which has no /admin route and never
  // will; only a full page load gets there. react-router marks the anchors
  // it renders with data-discover, so its absence is what distinguishes the
  // two here.
  it("links to the admin app with a plain anchor, not a router link", () => {
    renderHeader("/");
    const admin = screen.getByRole("link", { name: "Admin" });
    expect(admin).toHaveAttribute("href", "/admin");
    expect(admin).not.toHaveAttribute("data-discover");
  });

  it("never renders the admin chrome or a signed-in user", () => {
    const { container } = renderHeader("/");
    expect(container.querySelector(".admin-header")).toBeNull();
    expect(container.querySelector(".header-user-section")).toBeNull();
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

  // The mobile title swaps to .header-title-mobile ALONE — .header-title
  // does not apply — so header.css styles it through the `.header`
  // descendant rule, which is the only thing declaring its font-weight. If
  // this class or the bar around it drifts, the title silently falls back
  // to the body default (it did: the #356 opt-ins were enumerated per
  // desktop class and missed this one).
  it("styles the title through the header bar's mobile class", () => {
    const { container } = renderHeader("/");
    const title = container.querySelector(".header > .header-title-mobile");
    expect(title).toHaveTextContent("Kari Davidson");
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
