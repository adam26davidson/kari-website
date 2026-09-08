import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { MobileMenu } from "./mobile-menu";
import { MOBILE_MENU_ID, PAGES } from "@kari/shared/constants";

function renderMenu(path: string, setShowingMobileMenu = vi.fn()) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <MobileMenu setShowingMobileMenu={setShowingMobileMenu} />
    </MemoryRouter>,
  );
  return { setShowingMobileMenu, container: view.container };
}

describe("MobileMenu", () => {
  // The hamburger's aria-controls names this id, so a screen reader can
  // follow the button to the menu it opens (#502).
  it("carries the id the hamburger's aria-controls names", () => {
    const { container } = renderMenu("/");
    const menu = container.querySelector(".mobile-menu");
    expect(menu).toHaveAttribute("id", MOBILE_MENU_ID);
  });

  it("renders one mobile-menu-item link per page", () => {
    renderMenu("/");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(PAGES.length);
    for (const page of PAGES) {
      const link = screen.getByRole("link", { name: page.name });
      expect(link).toHaveAttribute("href", page.path);
      expect(link).toHaveClass("mobile-menu-item");
    }
  });

  // Same rule as the desktop bar: the admin app is reached by URL, never
  // from the public site's navigation.
  it("does not link to the admin app", () => {
    renderMenu("/");
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    expect(document.querySelector('a[href^="/admin"]')).toBeNull();
  });

  it("marks only the link for the current route as active", () => {
    renderMenu("/haiku");
    const current = screen.getByRole("link", { name: "Haiku" });
    expect(current).toHaveClass("mobile-menu-item", "active");
    const other = screen.getByRole("link", { name: "Haiga" });
    expect(other).toHaveClass("mobile-menu-item");
    expect(other).not.toHaveClass("active");
  });

  it("closes the menu when a link is clicked", async () => {
    const { setShowingMobileMenu } = renderMenu("/");
    await userEvent.click(screen.getByRole("link", { name: "Haiku" }));
    expect(setShowingMobileMenu).toHaveBeenCalledWith(false);
  });
});
