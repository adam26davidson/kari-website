import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Header } from "./header";
import { MOBILE_MENU_ID, PAGES } from "@kari/shared/constants";
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

  // The bar renders on every public route, so the site title is the only
  // heading the home, haiku, haiga, photography and other-works pages have
  // to offer: as a <div> those pages carried no level-1 heading at all and
  // a screen-reader user jumping by headings landed on nothing (#504).
  it("marks the site title as the page's level-1 heading", () => {
    renderHeader("/");
    expect(
      screen.getByRole("heading", { level: 1, name: "Kari Davidson" }),
    ).toBeInTheDocument();
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

  // The class swaps below 768px; the element must not. A phone visitor gets
  // the same one heading a desktop visitor does (#504).
  it("keeps the site title a level-1 heading on mobile", () => {
    renderHeader("/");
    expect(
      screen.getByRole("heading", { level: 1, name: "Kari Davidson" }),
    ).toHaveClass("header-title-mobile");
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

  // Without this a screen reader announces the hamburger as a plain button:
  // nothing says whether the menu it opens is currently showing (#502).
  it("reports the menu's collapsed state on the hamburger", () => {
    renderHeader("/", { showingMobileMenu: false });
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    // The menu is not mounted while collapsed, and aria-controls may only
    // name an element that exists.
    expect(button).not.toHaveAttribute("aria-controls");
  });

  it("reports the menu's expanded state and points at it", () => {
    renderHeader("/", { showingMobileMenu: true });
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", MOBILE_MENU_ID);
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
