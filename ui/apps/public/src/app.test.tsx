import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "./app";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { SiteSettingsService } from "@kari/shared/services/site-settings";

// App is a shell: Header + routes. Mock the lazy page modules to light
// stubs so these tests exercise routing without pulling in every page's
// dependency stack (the router lives in main.tsx, outside App, so tests
// provide a MemoryRouter).
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
vi.mock("@kari/shared/hooks/use-is-mobile", () => ({
  useIsMobile: vi.fn(),
}));

// App calls useSiteBackground, which reads site-settings.json straight
// from S3. Nothing here asserts on the background, and an unstubbed call
// reaches for a hostname that does not resolve — a real network attempt
// per test, each one logging a fetch failure over the run's output. The
// hook's own behaviour is covered in use-site-background.test.tsx.
vi.mock("@kari/shared/services/site-settings", () => ({
  SiteSettingsService: {
    getFromS3: vi.fn(),
  },
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
  // Re-stubbed per test: setup.ts's vi.restoreAllMocks() drops any
  // implementation set at mock-declaration time.
  vi.mocked(SiteSettingsService.getFromS3).mockResolvedValue({
    backgroundPhoto: "",
  });
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

  // The admin section is its own application now (#591). This app has no
  // /admin route, so the URL matches nothing and the outlet stays empty —
  // the header's plain <a href="/admin"> is the only way there, and it
  // leaves this SPA entirely.
  it("registers no admin route: /admin matches nothing here", async () => {
    const { container } = renderApp("/admin/haiku/some-id");
    expect(screen.getByText("Kari Davidson")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector(".content")).toBeEmptyDOMElement();
  });

  it("redirects /blog to /other-works", async () => {
    renderApp("/blog");
    expect(
      await screen.findByText("Other works page stub"),
    ).toBeInTheDocument();
  });

  it("does not register whats-on-test as a public route (it lives in the admin app)", async () => {
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
