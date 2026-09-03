import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Admin } from "./admin";
import { useAuth0 } from "@auth0/auth0-react";

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: vi.fn(),
}));

// The sub-pages have their own tests; stub them so this file exercises
// only the shell: auth gating, the menu, and section routing.
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

describe("Admin authentication gating", () => {
  it("offers login when unauthenticated", () => {
    mockAuth({ isAuthenticated: false });
    renderAdmin();

    fireEvent.click(screen.getByRole("button", { name: "Log In" }));

    expect(loginWithRedirect).toHaveBeenCalledOnce();
    expect(screen.queryByText("Home")).toBeNull();
  });

  it("shows neither login nor menu while auth is loading", () => {
    mockAuth({ isAuthenticated: false, isLoading: true });
    renderAdmin();

    expect(screen.queryByRole("button", { name: "Log In" })).toBeNull();
    expect(screen.queryByText("Home")).toBeNull();
  });
});

describe("Admin menu", () => {
  it("lists every admin section as a link to its route, in order", () => {
    // Stub the staging flag off so this pins the production menu; the
    // staging-only section has its own describe block below.
    vi.stubEnv("VITE_SHOW_TEST_STATUS", "");
    renderAdmin();

    const links = screen.getAllByRole("link");
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
    expect(screen.getByRole("link", { name: "Home" })).toHaveClass("selected");
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
    expect(screen.getByRole("link", { name: label })).toHaveClass("selected");
    expect(screen.queryByText("home-page-stub")).toBeNull();
  });

  it("opens a section directly from its URL", () => {
    renderAdmin("/admin/haiku");
    expect(screen.getByText("haiku-page-stub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Haiku" })).toHaveClass("selected");
  });

  it("marks the section link selected on its editor URLs too", () => {
    renderAdmin("/admin/haiku/some-id");
    expect(screen.getByRole("link", { name: "Haiku" })).toHaveClass("selected");
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
    expect(link).toHaveClass("selected");
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

// jsdom applies no stylesheet, so the phone menu's sizing is read out of the
// CSS rather than measured.
describe("the admin menu at phone width", () => {
  const strip = (path: string) =>
    readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
  const adminCss = strip("apps/admin/src/admin.css");
  const atPhoneWidth = (() => {
    const media = adminCss.indexOf("@media (max-width: 767.98px)");
    expect(media).toBeGreaterThanOrEqual(0);
    return adminCss.slice(adminCss.indexOf("{", media) + 1);
  })();
  const block = (selector: string) =>
    atPhoneWidth.match(
      new RegExp(
        `(?:^|\\})\\s*${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`,
      ),
    )?.[1] ?? "";

  // Eight links at a ~35px pitch with no row gap read as a dense index
  // rather than a menu (design brief §1), and 35px is under the size a
  // fingertip stops missing at — the same 44px floor the list rows' own
  // controls take at this breakpoint.
  it("gives every link a fingertip-sized row", () => {
    const menuItem = block(".admin-menu-item");
    expect(menuItem).toMatch(/min-height\s*:\s*(4[4-9]|[5-9]\d)px/);
    // Without border-box the base rule's content-box adds the padding on
    // top of the floor, so the number above would not be what she taps.
    expect(menuItem).toMatch(/box-sizing\s*:\s*border-box/);
  });

  it("separates the rows rather than letting them meet", () => {
    expect(block(".admin-menu")).toMatch(/gap\s*:\s*[1-9]/);
  });

  // The menu is width:100%, so any side padding it takes has to come out of
  // that 100% — content-box pushed the grid past a 390px viewport by
  // exactly the padding.
  it("keeps its side padding inside the viewport", () => {
    expect(block(".admin-menu")).toMatch(/box-sizing\s*:\s*border-box/);
  });
});
