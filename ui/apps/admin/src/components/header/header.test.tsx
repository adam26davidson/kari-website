import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "./header";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { MOBILE_MENU_ID } from "@kari/shared/constants";

vi.mock("@kari/shared/hooks/use-is-mobile", () => ({
  useIsMobile: vi.fn(),
}));

// The user section is this bar's only Auth0 consumer, and nothing here
// mounts a provider.
vi.mock("../../auth/admin-auth", () => ({
  HeaderUserSection: () => <div>User section stub</div>,
}));

function renderHeader(showingMobileMenu = false) {
  const setShowingMobileMenu = vi.fn();
  const view = render(
    <Header
      showingMobileMenu={showingMobileMenu}
      setShowingMobileMenu={setShowingMobileMenu}
    />,
  );
  return { container: view.container, setShowingMobileMenu };
}

beforeEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false);
});

describe("the admin header on desktop", () => {
  it("wears the admin chrome and says so in the title", () => {
    const { container } = renderHeader();
    expect(container.querySelector(".admin-header")).not.toBeNull();
    expect(container.querySelector(".header")).toBeNull();
    expect(screen.getByText("Kari Davidson - Admin")).toBeInTheDocument();
  });

  // Every admin page opens with an <h2 class="admin-section-heading">, and
  // nothing above them was a heading at all: the outline started at level 2
  // with no level 1 over it. The bar's title is that level 1 (#504).
  it("marks the admin title as the page's level-1 heading", () => {
    renderHeader();
    expect(
      screen.getByRole("heading", { level: 1, name: "Kari Davidson - Admin" }),
    ).toBeInTheDocument();
  });

  it("shows the signed-in user", () => {
    renderHeader();
    expect(screen.getByText("User section stub")).toBeInTheDocument();
  });

  // The public site's nav belongs to the public app; this bar has none, and
  // the way out is the phone menu (or the browser).
  it("carries no site navigation", () => {
    renderHeader();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not render the hamburger menu button", () => {
    renderHeader();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  });
});

describe("the admin header on mobile", () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(true);
  });

  // The mobile title swaps to .header-title-mobile ALONE — .admin-header-title
  // does not apply — so header.css styles it through the `.admin-header`
  // descendant rule, which is the only thing declaring its font-weight (#356).
  it("styles the title through the admin bar's mobile class", () => {
    const { container } = renderHeader();
    const title = container.querySelector(
      ".admin-header > .header-title-mobile",
    );
    expect(title).toHaveTextContent("Kari Davidson - Admin");
  });

  // The class swaps below 768px; the element must not (#504).
  it("keeps the admin title a level-1 heading on mobile", () => {
    renderHeader();
    expect(
      screen.getByRole("heading", { level: 1, name: "Kari Davidson - Admin" }),
    ).toHaveClass("header-title-mobile");
  });

  it("toggles the phone menu open when the hamburger is clicked", async () => {
    const { setShowingMobileMenu } = renderHeader(false);
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(setShowingMobileMenu).toHaveBeenCalledWith(true);
  });

  it("toggles the phone menu closed when it is already open", async () => {
    const { setShowingMobileMenu } = renderHeader(true);
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(setShowingMobileMenu).toHaveBeenCalledWith(false);
  });

  // Without this a screen reader announces the hamburger as a plain button:
  // nothing says whether the menu it opens is currently showing (#502).
  it("reports the menu's collapsed state on the hamburger", () => {
    renderHeader(false);
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    // The menu is not mounted while collapsed, and aria-controls may only
    // name an element that exists.
    expect(button).not.toHaveAttribute("aria-controls");
  });

  it("reports the menu's expanded state and points at it", () => {
    renderHeader(true);
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", MOBILE_MENU_ID);
  });
});
