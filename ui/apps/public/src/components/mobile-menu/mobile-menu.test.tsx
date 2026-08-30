import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { MobileMenu } from "./mobile-menu";
import { PAGES } from "@kari/shared/constants";

function renderMenu(path: string, setShowingMobileMenu = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MobileMenu setShowingMobileMenu={setShowingMobileMenu} />
    </MemoryRouter>,
  );
  return setShowingMobileMenu;
}

describe("MobileMenu", () => {
  it("renders one mobile-menu-item link per page, plus Admin", () => {
    renderMenu("/");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(PAGES.length + 1);
    for (const page of PAGES) {
      const link = screen.getByRole("link", { name: page.name });
      expect(link).toHaveAttribute("href", page.path);
      expect(link).toHaveClass("mobile-menu-item");
    }
  });

  // The admin section is a separate application served under /admin, so
  // this has to be a plain anchor: a router Link would try to resolve
  // /admin inside this app's route tree and render nothing. On a phone the
  // nav bar collapses into this menu, so without the entry there is no way
  // in at all.
  it("links to the admin app with a plain anchor, not a router link", () => {
    renderMenu("/");
    const admin = screen.getByRole("link", { name: "Admin" });
    expect(admin).toHaveAttribute("href", "/admin");
    expect(admin).toHaveClass("mobile-menu-item");
    expect(admin).not.toHaveAttribute("data-discover");
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
    const setShowingMobileMenu = renderMenu("/");
    await userEvent.click(screen.getByRole("link", { name: "Haiku" }));
    expect(setShowingMobileMenu).toHaveBeenCalledWith(false);
  });
});
