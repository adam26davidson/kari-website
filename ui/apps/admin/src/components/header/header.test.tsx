import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "./header";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";

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
});
