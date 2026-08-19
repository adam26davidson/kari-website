import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./app";
import { useIsMobile } from "./hooks/use-is-mobile";

// App is a shell: Header + routes. Mock the lazy page modules to light
// stubs so these tests exercise routing without pulling in every page's
// dependency stack (BrowserRouter and Auth0Provider live in main.tsx,
// outside App, so tests provide a MemoryRouter and mock useAuth0).
vi.mock("./pages/home-page/home-page", () => ({
  Home: () => <div>Home page stub</div>,
}));
vi.mock("./pages/haiku-page/haiku-page", () => ({
  HaikuPage: () => <div>Haiku page stub</div>,
}));
vi.mock("./pages/haiga-page/haiga-page", () => ({
  HaigaPage: () => <div>Haiga page stub</div>,
}));
vi.mock("./pages/other-works/other-works-page", () => ({
  OtherWorksPage: () => <div>Other works page stub</div>,
}));
vi.mock("./pages/blog-post/blog-post-page", () => ({
  BlogPostPage: () => <div>Blog post page stub</div>,
}));
vi.mock("./pages/photography-page/photography-page", () => ({
  PhotographyPage: () => <div>Photography page stub</div>,
}));
vi.mock("./pages/admin/admin", () => ({
  Admin: () => <div>Admin page stub</div>,
}));
// Not imported by app.tsx — the page is reachable only from inside the
// admin shell. Stubbed anyway so that if it is ever wired up as a public
// route again, the guard below sees a recognisable stub instead of the
// real page (which would fetch, likely throw, and get swallowed by the
// route error boundary).
vi.mock(
  "./pages/admin/admin-whats-on-test-page/admin-whats-on-test-page",
  () => ({
    AdminWhatsOnTestPage: () => <div>Whats-on-test page stub</div>,
  }),
);
vi.mock("./hooks/use-is-mobile", () => ({
  useIsMobile: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    user: undefined,
    isAuthenticated: false,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("App", () => {
  it("renders the header and the home route", async () => {
    renderApp("/");
    expect(screen.getByText("Kari Davidson")).toBeInTheDocument();
    expect(await screen.findByText("Home page stub")).toBeInTheDocument();
  });

  it("renders the matching page for a direct route", async () => {
    renderApp("/haiku");
    expect(await screen.findByText("Haiku page stub")).toBeInTheDocument();
  });

  it("routes nested admin paths to the admin shell", async () => {
    renderApp("/admin/haiku/some-id");
    expect(await screen.findByText("Admin page stub")).toBeInTheDocument();
  });

  it("redirects /blog to /other-works", async () => {
    renderApp("/blog");
    expect(
      await screen.findByText("Other works page stub"),
    ).toBeInTheDocument();
  });

  it("does not register whats-on-test as a public route (it lives under /admin)", async () => {
    const { container } = renderApp("/whats-on-test");
    // The shell still renders; the unmatched route just shows nothing.
    expect(screen.getByText("Kari Davidson")).toBeInTheDocument();

    // A matched lazy route shows the Suspense fallback on the very first
    // render, before its chunk resolves — so this alone fails the moment
    // any public /whats-on-test route is (re)added.
    expect(screen.queryByText("Loading...")).toBeNull();

    // Flush the lazy import + Suspense so absence is proven after the
    // page would have had a chance to render, not merely before it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("Whats-on-test page stub")).toBeNull();
    expect(screen.queryByText(/what's on test/i)).toBeNull();
    // Nothing at all matched: the route outlet stays empty (this also
    // catches a page that rendered and then threw into the boundary).
    expect(container.querySelector(".content")).toBeEmptyDOMElement();
  });

  it("shows the mobile menu instead of the route when opened, and closes on selection", async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    renderApp("/");
    expect(await screen.findByText("Home page stub")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("link", { name: "Haiku" })).toHaveClass(
      "mobile-menu-item",
    );
    expect(screen.queryByText("Home page stub")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Haiku" }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(await screen.findByText("Haiku page stub")).toBeInTheDocument();
  });
});
