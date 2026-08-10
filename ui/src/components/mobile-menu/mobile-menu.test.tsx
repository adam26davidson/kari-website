import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MobileMenu } from "./mobile-menu";
import { PAGES } from "../../constants";

function renderMenu(path: string, setShowingMobileMenu = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MobileMenu setShowingMobileMenu={setShowingMobileMenu} />
    </MemoryRouter>,
  );
  return setShowingMobileMenu;
}

describe("MobileMenu", () => {
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
