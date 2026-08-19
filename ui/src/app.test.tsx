import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("./pages/whats-on-test/whats-on-test-page", () => ({
  WhatsOnTestPage: () => <div>Whats-on-test page stub</div>,
}));

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

  it("registers the whats-on-test route when the staging flag is set", async () => {
    vi.stubEnv("VITE_SHOW_TEST_STATUS", "true");
    renderApp("/whats-on-test");
    expect(
      await screen.findByText("Whats-on-test page stub"),
    ).toBeInTheDocument();
  });

  it("does not register the whats-on-test route without the staging flag", () => {
    // Vitest runs in mode "test", whose .env.test sets the flag (so the
    // e2e bundle shows the page); stub it off to exercise the prod build.
    vi.stubEnv("VITE_SHOW_TEST_STATUS", "");
    renderApp("/whats-on-test");
    expect(screen.queryByText("Whats-on-test page stub")).toBeNull();
    // The shell still renders; the unmatched route just shows nothing.
    expect(screen.getByText("Kari Davidson")).toBeInTheDocument();
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
