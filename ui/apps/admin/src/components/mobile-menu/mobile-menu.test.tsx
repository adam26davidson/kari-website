import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileMenu } from "./mobile-menu";
import { MOBILE_MENU_ID, PAGES } from "@kari/shared/constants";

function renderMenu(setShowingMobileMenu = vi.fn()) {
  const view = render(
    // These are real anchors to another application, and jsdom answers a
    // real navigation with a "Not implemented" error on stderr. Swallowing
    // the default here keeps the run's output clean without pretending the
    // links are anything other than anchors.
    <div onClick={(event) => event.preventDefault()}>
      <MobileMenu setShowingMobileMenu={setShowingMobileMenu} />
    </div>,
  );
  return { setShowingMobileMenu, container: view.container };
}

describe("the admin phone menu", () => {
  // The hamburger's aria-controls names this id, so a screen reader can
  // follow the button to the menu it opens (#502).
  it("carries the id the hamburger's aria-controls names", () => {
    const { container } = renderMenu();
    const menu = container.querySelector(".mobile-menu");
    expect(menu).toHaveAttribute("id", MOBILE_MENU_ID);
  });

  it("renders one link per public page", () => {
    renderMenu();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(PAGES.length);
    for (const page of PAGES) {
      const link = screen.getByRole("link", { name: page.name });
      expect(link).toHaveAttribute("href", page.path);
      expect(link).toHaveClass("mobile-menu-item");
    }
  });

  // Every entry leaves this application for the public build, so these are
  // plain anchors — a router link would resolve them against the /admin
  // basename and land on /admin/haiku, which is not a public page at all.
  // react-router marks the anchors it renders with data-discover.
  it("uses plain anchors, not router links", () => {
    renderMenu();
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("data-discover");
    }
  });

  it("closes the menu when a link is clicked", async () => {
    const { setShowingMobileMenu } = renderMenu();
    await userEvent.click(screen.getByRole("link", { name: "Haiku" }));
    expect(setShowingMobileMenu).toHaveBeenCalledWith(false);
  });
});
