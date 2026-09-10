import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Admin } from "./admin";
import { useAuth0 } from "@auth0/auth0-react";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: vi.fn(),
}));

// The sub-pages have their own tests; stub them so this file exercises
// only what Admin itself decides: auth gating, which sections exist and in
// what order, and section routing. The shell that draws them has its own
// tests in components/app-shell/.
vi.mock("./home-page-editor/home-page-editor", () => ({
  HomePageEditor: () => <div>home-page-stub</div>,
}));
vi.mock("./admin-haiku-page/admin-haiku-page", () => ({
  AdminHaikuPage: () => <div>haiku-page-stub</div>,
}));
vi.mock("./admin-haiga-page/admin-haiga-page", () => ({
  AdminHaigaPage: () => <div>haiga-page-stub</div>,
}));
vi.mock("./admin-other-works-page/admin-other-works-page", () => ({
  AdminOtherWorksPage: () => <div>other-works-page-stub</div>,
}));
vi.mock("./admin-photography-page/admin-photography-page", () => ({
  AdminPhotographyPage: () => <div>photography-page-stub</div>,
}));
vi.mock("./admin-image-gc-page/admin-image-gc-page", () => ({
  AdminImageGcPage: () => <div>image-gc-page-stub</div>,
}));
vi.mock("./admin-background-page/admin-background-page", () => ({
  AdminBackgroundPage: () => <div>background-page-stub</div>,
}));
vi.mock("./admin-whats-on-test-page/admin-whats-on-test-page", () => ({
  AdminWhatsOnTestPage: () => <div>whats-on-test-page-stub</div>,
}));

const loginWithRedirect = vi.fn();

function mockAuth(overrides?: {
  isAuthenticated?: boolean;
  isLoading?: boolean;
}) {
  vi.mocked(useAuth0).mockReturnValue({
    isAuthenticated: overrides?.isAuthenticated ?? true,
    isLoading: overrides?.isLoading ?? false,
    loginWithRedirect,
  } as unknown as ReturnType<typeof useAuth0>);
}

// Mounted the way main.tsx mounts it: as the catch-all of a router whose
// basename is /admin. The basename is deliberately part of the fixture --
// every route inside this app is written as if it owned the site root, and
// what a maintainer's browser actually shows (and what the e2e journeys
// click) is those paths with /admin in front. Entries are therefore real
// URLs, and the href assertions below are real hrefs.
function renderAdmin(path: string = "/admin") {
  return render(
    <MemoryRouter basename="/admin" initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<Admin />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The workshop nav, which is the shell's only list of sections. */
const sectionLinks = () =>
  within(screen.getByRole("navigation", { name: "Your workshop" })).getAllByRole(
    "link",
  );

describe("Admin authentication gating", () => {
  it("offers login when unauthenticated", () => {
    mockAuth({ isAuthenticated: false });
    renderAdmin();

    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    expect(loginWithRedirect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows neither login nor menu while auth is loading", () => {
    mockAuth({ isAuthenticated: false, isLoading: true });
    renderAdmin();

    expect(screen.queryByRole("button", { name: "Log In" })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  // The signed-out screen is the whole page, so it has to carry the <h1>
  // the shell's sidebar carries everywhere else (#504) — and it is where
  // e2e/smoke.spec.ts checks that /admin served the admin app at all.
  it.each([
    ["signed out", false],
    ["still checking", true],
  ])("names the app while %s", (_state, isLoading) => {
    mockAuth({ isAuthenticated: false, isLoading });
    renderAdmin();

    expect(
      screen.getByRole("heading", { level: 1, name: "Kari Davidson - Admin" }),
    ).toBeInTheDocument();
  });
});

describe("Admin menu", () => {
  it("lists every admin section as a link to its route, in order", () => {
    // Stub the staging flag off so this pins the production menu; the
    // staging-only section has its own describe block below.
    vi.stubEnv("VITE_SHOW_TEST_STATUS", "");
    renderAdmin();

    const links = sectionLinks();
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Haiku",
      "Haiga",
      "Photography",
      "Other works",
      "Appearance",
      "Image cleanup",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/admin/home",
      "/admin/haiku",
      "/admin/haiga",
      "/admin/photography",
      "/admin/other-works",
      "/admin/background",
      "/admin/image-cleanup",
    ]);
  });

  it("redirects /admin to the home section", () => {
    renderAdmin("/admin");
    expect(screen.getByText("home-page-stub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it.each([
    ["Haiku", "haiku-page-stub"],
    ["Haiga", "haiga-page-stub"],
    ["Photography", "photography-page-stub"],
    ["Other works", "other-works-page-stub"],
    ["Appearance", "background-page-stub"],
    ["Image cleanup", "image-gc-page-stub"],
  ])("switches to %s on click", (label, stub) => {
    renderAdmin();

    fireEvent.click(screen.getByRole("link", { name: label }));

    expect(screen.getByText(stub)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByText("home-page-stub")).toBeNull();
  });

  it("opens a section directly from its URL", () => {
    renderAdmin("/admin/haiku");
    expect(screen.getByText("haiku-page-stub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Haiku" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // aria-current, not a class: which section she is in is said to a screen
  // reader by the link itself, and NavLink is what sets it. The green pill
  // that says the same thing to everyone else is a Tailwind class the
  // shell's own tests cover.
  it("marks the section link current on its editor URLs too", () => {
    renderAdmin("/admin/haiku/some-id");
    expect(screen.getByRole("link", { name: "Haiku" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("redirects unknown sections to home", () => {
    renderAdmin("/admin/nonsense");
    expect(screen.getByText("home-page-stub")).toBeInTheDocument();
  });
});

describe("Admin what's-on-test section (staging-only)", () => {
  // Vitest runs in mode "test", whose .env.test sets the flag (so the
  // e2e bundle shows the section); stub it off to exercise the prod build.
  it("adds the menu entry and route when the staging flag is set", async () => {
    vi.stubEnv("VITE_SHOW_TEST_STATUS", "true");
    renderAdmin("/admin/whats-on-test");

    expect(
      await screen.findByText("whats-on-test-page-stub"),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "What's on test" });
    expect(link).toHaveAttribute("href", "/admin/whats-on-test");
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("has neither the menu entry nor the route without the staging flag", () => {
    vi.stubEnv("VITE_SHOW_TEST_STATUS", "");
    renderAdmin("/admin/whats-on-test");

    expect(screen.queryByRole("link", { name: "What's on test" })).toBeNull();
    expect(screen.queryByText("whats-on-test-page-stub")).toBeNull();
    // The unknown section falls through to the home redirect.
    expect(screen.getByText("home-page-stub")).toBeInTheDocument();
  });
});
