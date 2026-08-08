import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { useIsMobile } from "./hooks/isMobile";

// App is a shell: Header + routes. Mock the lazy page modules to light
// stubs so these tests exercise routing without pulling in every page's
// dependency stack (BrowserRouter and Auth0Provider live in main.tsx,
// outside App, so tests provide a MemoryRouter and mock useAuth0).
vi.mock("./pages/homePage/homePage", () => ({
  default: () => <div>Home page stub</div>,
}));
vi.mock("./pages/haikuPage/haikuPage", () => ({
  HaikuPage: () => <div>Haiku page stub</div>,
}));
vi.mock("./pages/haigaPage/haigaPage", () => ({
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
  default: () => <div>Admin page stub</div>,
}));

vi.mock("./hooks/isMobile", () => ({
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

  it("redirects /blog to /other-works", async () => {
    renderApp("/blog");
    expect(
      await screen.findByText("Other works page stub"),
    ).toBeInTheDocument();
  });

  it("shows the mobile menu instead of the route when opened, and closes on selection", async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const { container } = renderApp("/");
    expect(await screen.findByText("Home page stub")).toBeInTheDocument();

    await userEvent.click(
      container.querySelector(".header-menu-icon") as Element,
    );
    expect(screen.getByRole("link", { name: "Haiku" })).toHaveClass(
      "mobile-menu-item",
    );
    expect(screen.queryByText("Home page stub")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Haiku" }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(await screen.findByText("Haiku page stub")).toBeInTheDocument();
  });
});
