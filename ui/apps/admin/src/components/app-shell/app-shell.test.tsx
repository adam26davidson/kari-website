import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { House, PenLine } from "lucide-react";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { PAGES } from "@kari/shared/constants";
import { AppShell } from "./app-shell";
import { useAdminAccount } from "../../auth/use-admin-account";

vi.mock("@kari/shared/hooks/use-is-mobile", () => ({ useIsMobile: vi.fn() }));
vi.mock("../../auth/use-admin-account", () => ({
  useAdminAccount: vi.fn(),
}));

const signOut = vi.fn();

const PAGES_FIXTURE = [
  { id: "home", label: "Home", icon: House },
  { id: "haiku", label: "Haiku", icon: PenLine },
];

/**
 * The shell picks its layout from two `useIsMobile` calls, one per
 * breakpoint. Driving the real hook's contract (`width < breakpoint`) from
 * one number keeps these tests phrased in viewport widths rather than in
 * booleans, which is how the boards describe the three layouts.
 */
function renderShellAt(width: number) {
  vi.mocked(useIsMobile).mockImplementation(
    (breakpoint = 768) => width < breakpoint,
  );
  const user = userEvent.setup();
  render(
    <MemoryRouter basename="/admin" initialEntries={["/admin/haiku"]}>
      <AppShell pages={PAGES_FIXTURE}>
        <div>page content</div>
      </AppShell>
    </MemoryRouter>,
  );
  return user;
}

/** The section links, whichever of the three navs is mounted. */
const sectionLinks = () =>
  within(screen.getByRole("navigation", { name: "Your workshop" })).getAllByRole(
    "link",
  );

beforeEach(() => {
  vi.mocked(useAdminAccount).mockReturnValue({
    name: "Kari",
    initial: "K",
    signOut,
  });
});

// One nav in the DOM at a time is the whole reason the shell branches in JS
// rather than hiding two copies with CSS: `e2e/helpers.ts`, `auth.setup.ts`
// and two specs reach a section by `.admin-menu-item`, and three copies per
// section would fail Playwright's strict mode on every one of them.
describe("the admin shell at each width", () => {
  it.each([
    ["desktop", 1440],
    ["tablet", 900],
    ["phone", 390],
  ])("mounts exactly one nav and one link per section at %s", async (_at, width) => {
    const user = renderShellAt(width);
    if (width < 768) {
      // The phone's nav lives behind the hamburger; open it first.
      await user.click(screen.getByRole("button", { name: "Menu" }));
    }
    expect(screen.getAllByRole("navigation", { name: "Your workshop" }))
      .toHaveLength(1);
    expect(document.querySelectorAll(".admin-menu-item")).toHaveLength(
      PAGES_FIXTURE.length,
    );
  });

  it.each([
    ["desktop", 1440],
    ["tablet", 900],
  ])("names every section at %s, icon-only or not", (_at, width) => {
    renderShellAt(width);
    expect(sectionLinks().map((link) => link.textContent)).toEqual([
      "Home",
      "Haiku",
    ]);
    expect(sectionLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/admin/home",
      "/admin/haiku",
    ]);
  });

  // Which section she is in, said in the one way that is not a colour: the
  // pill is Tailwind's, but `aria-current="page"` is what a screen reader
  // reads and what admin-whats-on-test.spec.ts asserts. The legacy nav said
  // it with a `.selected` class; nothing carries that now, and the e2e spec
  // asserting the old marker is exactly what this test would have caught.
  it.each([
    ["desktop", 1440],
    ["tablet", 900],
  ])("marks the section she is in at %s", (_at, width) => {
    renderShellAt(width);
    expect(
      sectionLinks().map((link) => link.getAttribute("aria-current")),
    ).toEqual([null, "page"]);
  });

  it("marks the section she is in in the phone menu", async () => {
    const user = renderShellAt(390);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(
      sectionLinks().map((link) => link.getAttribute("aria-current")),
    ).toEqual([null, "page"]);
  });

  // #504's outline: the admin pages open at level 2, so the shell owes the
  // document its <h1> — including at tablet width, where the icon rail has
  // no room to draw it.
  it.each([
    ["desktop", 1440],
    ["tablet", 900],
    ["phone", 390],
  ])("carries the page's one h1 at %s", (_at, width) => {
    renderShellAt(width);
    expect(
      screen.getAllByRole("heading", { level: 1, name: "Kari Davidson - Admin" }),
    ).toHaveLength(1);
  });

  it("shows the page content beside the nav at desktop", () => {
    renderShellAt(1440);
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});

describe("the desktop sidebar", () => {
  it("links out to the public site", () => {
    renderShellAt(1440);
    expect(screen.getByRole("link", { name: "See your site" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows who is signed in and signs them out", async () => {
    const user = renderShellAt(1440);
    expect(screen.getByText("Kari")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("the tablet icon rail", () => {
  it("keeps the way out and the sign-out reachable without labels", async () => {
    const user = renderShellAt(900);
    expect(screen.getByRole("link", { name: "See your site" })).toHaveAttribute(
      "href",
      "/",
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  // The rail is a single column of stacked icon-over-label pills, and its
  // width has been tuned twice for how the longest label wraps in it. Both
  // times the two entries at the FOOT of the rail — which are written out
  // in icon-rail.tsx rather than coming from SectionLink — were a separate
  // place to remember. They now share one `RAIL_PILL`, and this is what
  // says so: every entry the same width, or the column is ragged.
  it("gives every entry in the rail the same pill", () => {
    renderShellAt(900);
    const widthClass = (element: Element) =>
      [...element.classList].find((name) => /^w-\d/.test(name));
    const entries = [
      ...sectionLinks(),
      screen.getByRole("link", { name: "See your site" }),
      screen.getByRole("button", { name: "Sign out" }),
    ];
    const widths = new Set(entries.map(widthClass));
    expect(widths.size, `rail pill widths: ${[...widths].join(", ")}`).toBe(1);
    expect([...widths][0]).toBeDefined();
  });

  // The rail has no room for the name, so the tooltip is where it goes —
  // and the rail renders before Auth0 has a profile, so the tooltip has to
  // read as a sentence either way.
  it("names who the sign-out belongs to when there is a name", () => {
    renderShellAt(900);
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveAttribute(
      "title",
      "Sign out (Kari)",
    );
  });

  it("still labels the sign-out before a name is known", () => {
    vi.mocked(useAdminAccount).mockReturnValue({
      name: "",
      initial: "",
      signOut,
    });
    renderShellAt(900);
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveAttribute(
      "title",
      "Sign out",
    );
  });
});

describe("the phone shell", () => {
  it("starts closed, with the content showing", () => {
    renderShellAt(390);
    const hamburger = screen.getByRole("button", { name: "Menu" });
    expect(hamburger).toHaveAttribute("aria-expanded", "false");
    // The attribute may only name an element that is in the document, and
    // the menu is mounted on demand (#502).
    expect(hamburger).not.toHaveAttribute("aria-controls");
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("swaps the content for the menu when opened", async () => {
    const user = renderShellAt(390);
    await user.click(screen.getByRole("button", { name: "Menu" }));

    const hamburger = screen.getByRole("button", { name: "Menu" });
    expect(hamburger).toHaveAttribute("aria-expanded", "true");
    expect(hamburger).toHaveAttribute("aria-controls", "mobile-menu");
    expect(document.getElementById("mobile-menu")).not.toBeNull();
    expect(screen.queryByText("page content")).toBeNull();
  });

  // The phone menu is the ONLY place both navigations meet: before #592 the
  // hamburger listed the public pages alone, so on a phone the workshop's
  // own sections were reachable only from a grid wedged above the content.
  it("merges the workshop's sections with the public site's pages", async () => {
    const user = renderShellAt(390);
    await user.click(screen.getByRole("button", { name: "Menu" }));

    expect(sectionLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/admin/home",
      "/admin/haiku",
    ]);

    // Plain anchors, not router links: every one of these leaves this
    // application for the public build, so their hrefs carry no basename.
    const outward = within(
      screen.getByRole("navigation", { name: "Your site" }),
    ).getAllByRole("link");
    expect(outward.map((link) => link.getAttribute("href"))).toEqual(
      PAGES.map((page) => page.path),
    );
  });

  it("closes itself when a section is chosen", async () => {
    const user = renderShellAt(390);
    await user.click(screen.getByRole("button", { name: "Menu" }));

    // By the workshop's own Home, not the public site's — the merged menu
    // lists a link of that name in each half.
    await user.click(
      within(screen.getByRole("navigation", { name: "Your workshop" })).getByRole(
        "link",
        { name: "Home" },
      ),
    );

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(document.getElementById("mobile-menu")).toBeNull();
  });

  it("signs out from the menu", async () => {
    const user = renderShellAt(390);
    await user.click(screen.getByRole("button", { name: "Menu" }));

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});
