import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { readFileSync } from "node:fs";
import { AdminItemList } from "./admin-item-list";

const items = [
  { id: "a", name: "alpha" },
  { id: "b", name: "beta" },
  { id: "c", name: "gamma" },
];

/**
 * Mounts the list on a memory router, since the search query lives in the
 * URL. `entries` is the history stack (last entry is the current one), so
 * a test can assert what the browser back button does.
 */
function renderList(overrides?: {
  title?: string;
  onEdit?: (id: string) => void;
  hideEdit?: boolean;
  compact?: boolean;
  getSearchText?: (item: { id: string; name: string }) => string;
  noun?: string;
  addVariant?: "primary" | "secondary" | "danger";
  deleteLabel?: string;
  entries?: Array<string>;
}) {
  const onNewItem = vi.fn();
  const onDelete = vi.fn();
  const onMove = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: "/things",
        element: (
          <AdminItemList
            items={items}
            title={overrides?.title}
            addLabel="Add a thing"
            addVariant={overrides?.addVariant}
            onNewItem={onNewItem}
            onDelete={onDelete}
            deleteLabel={overrides?.deleteLabel}
            onMove={onMove}
            onEdit={overrides?.onEdit}
            hideEdit={overrides?.hideEdit}
            compact={overrides?.compact}
            getSearchText={overrides?.getSearchText}
            noun={overrides?.noun}
            renderItem={(item) => <span>{item.name}</span>}
          />
        ),
      },
      { path: "*", element: <p>elsewhere</p> },
    ],
    { initialEntries: overrides?.entries ?? ["/things"] },
  );
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, onNewItem, onDelete, onMove, router };
}

const searchable = {
  getSearchText: (item: { name: string }) => item.name,
  noun: "things",
};

const search = (query: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: "Search things" }), {
    target: { value: query },
  });

// jsdom applies no stylesheet, so the spacing and sizing rules below are
// read out of the CSS rather than measured. Shared by the heading and
// phone-width groups.
const strip = (path: string) =>
  readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

const listCss = strip(
  "apps/admin/src/components/admin-item-list/admin-item-list.css",
);
const adminCss = strip("apps/admin/src/admin.css");

/** Everything inside the narrow-viewport media query. */
const atPhoneWidth = (() => {
  const media = listCss.indexOf("@media (max-width: 767.98px)");
  expect(media).toBeGreaterThanOrEqual(0);
  return listCss.slice(listCss.indexOf("{", media) + 1);
})();

/** A px-valued declaration of the rule for exactly `selector`. */
function px(css: string, selector: string, property: string): number {
  for (const [, selectors, block] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selectors.split(",").some((one) => one.trim() === selector)) {
      continue;
    }
    const match = block.match(
      new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?[\\d.]+)px`),
    );
    if (match) return Number(match[1]);
  }
  throw new Error(`No ${property} on "${selector}"`);
}

describe("AdminItemList", () => {
  it("renders every item through renderItem", () => {
    renderList();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });

  it("puts edit first and delete last in each row's controls", () => {
    const { container } = renderList({ onEdit: vi.fn() });
    // The middle row: it has all four controls (both move directions).
    const row = container.querySelectorAll(".admin-data-list-item")[1];
    const names = within(row as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.textContent || button.getAttribute("aria-label"));
    expect(names).toEqual(["Edit", "Move up", "Move down", "Delete"]);
  });

  // A pencil-in-a-circle and a bin-in-a-circle were the only affordance
  // offered for the two most consequential things she can do to a row. The
  // admin's one user does not read icons as vocabulary, and the words
  // survive the shadcn migration where the icons would not (#457, design
  // brief §3).
  describe("the two consequential row controls", () => {
    it("say what they do in a word, not only in an icon", () => {
      renderList({ onEdit: vi.fn() });
      for (const name of ["Edit", "Delete"]) {
        // getByRole matches an accessible name in full, so "Delete" here
        // cannot be satisfied by a longer deleteLabel.
        const buttons = screen.getAllByRole("button", { name });
        expect(buttons).toHaveLength(items.length);
        // The name comes from visible text, not from an aria-label
        // standing in for it.
        expect(buttons[0]).toHaveTextContent(name);
        expect(buttons[0]).not.toHaveAttribute("aria-label");
      }
    });

    it("dresses edit as a quiet control beside the page's primary", () => {
      renderList({ onEdit: vi.fn() });
      const edit = screen.getAllByRole("button", { name: "Edit" })[0];
      expect(edit).toHaveClass("admin-button", "secondary");
    });

    // Destructive and looks it — but outlined, so the page's one filled
    // button stays the thing she came to do (design brief §2).
    it("dresses delete as the destructive control it is", () => {
      renderList();
      for (const button of screen.getAllByRole("button", { name: "Delete" })) {
        expect(button).toHaveClass("admin-button", "danger-secondary");
      }
    });

    // The move arrows are directional and low-consequence, and the arrow
    // already says what "Move up" would. They stay circles so the row's
    // labelled pair does not get lost in four text buttons.
    it("leaves the move controls as labelled icon circles", () => {
      renderList();
      const up = screen.getAllByRole("button", { name: "Move up" })[0];
      expect(up).toHaveClass("admin-icon-button");
      expect(up).not.toHaveClass("danger");
    });
  });

  // Nested in an editor, the row is one part of the thing on screen and a
  // bare "Delete" does not say WHICH part — the caption, the photo, or the
  // whole post. deleteLabel replaces the word, not the button (#457).
  describe("a custom delete label", () => {
    it("names the thing it removes instead of saying just Delete", () => {
      renderList({ deleteLabel: "Remove this image" });
      expect(
        screen.queryByRole("button", { name: "Delete" }),
      ).not.toBeInTheDocument();
      const remove = screen.getAllByRole("button", {
        name: "Remove this image",
      });
      expect(remove).toHaveLength(items.length);
      // Destructive, but quiet: it only ever appears nested in an editor
      // whose primary is Save (design brief §2).
      expect(remove[0]).toHaveClass("admin-button", "danger-secondary");
    });

    it("still deletes the row it belongs to", () => {
      const { onDelete } = renderList({ deleteLabel: "Remove this image" });
      fireEvent.click(
        screen.getAllByRole("button", { name: "Remove this image" })[1],
      );
      expect(onDelete).toHaveBeenCalledWith("b");
    });
  });

  // On a list page adding IS the one obvious next action, so the button is
  // filled by default; nested in an editor, whose primary is Save, it has
  // to step down or the two compete as equals (design brief §2).
  it("dresses the add control as the page's primary action by default", () => {
    renderList();
    const add = screen.getByRole("button", { name: "Add a thing" });
    expect(add).toHaveClass("admin-button");
    expect(add).not.toHaveClass("secondary");
  });

  it("steps the add control down when asked for a secondary one", () => {
    renderList({ addVariant: "secondary" });
    expect(screen.getByRole("button", { name: "Add a thing" })).toHaveClass(
      "secondary",
    );
  });

  it("fires onNewItem from the add control", () => {
    const { onNewItem } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add a thing" }));
    expect(onNewItem).toHaveBeenCalledOnce();
  });

  it("fires onDelete with the item's id", () => {
    const { onDelete } = renderList();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    expect(onDelete).toHaveBeenCalledWith("b");
  });

  it("fires onEdit with the item's id", () => {
    const onEdit = vi.fn();
    renderList({ onEdit });
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[2]);
    expect(onEdit).toHaveBeenCalledWith("c");
  });

  it("omits move-up on the first item and move-down on the last", () => {
    renderList();
    // Items 1 and 2 can move up; items 0 and 1 can move down.
    expect(screen.getAllByRole("button", { name: "Move up" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Move down" })).toHaveLength(
      2,
    );
  });

  it("fires onMove with the id and direction", () => {
    const { onMove } = renderList();
    // The first "Move down" belongs to item a; the last "Move up" to
    // item c.
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    expect(onMove).toHaveBeenCalledWith("a", "down");
    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    expect(onMove).toHaveBeenCalledWith("c", "up");
  });

  it("hides the edit control when hideEdit is set", () => {
    renderList({ hideEdit: true });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("renders compact admin items when compact is set", () => {
    const { container } = renderList({ compact: true });
    expect(
      container.querySelectorAll(".admin-data-list-item.compact"),
    ).toHaveLength(3);
  });

  describe("search", () => {
    it("renders no search box unless getSearchText is given", () => {
      renderList();
      expect(screen.queryByRole("searchbox")).toBeNull();
    });

    it("filters items by case-insensitive substring, keeping order", () => {
      renderList(searchable);
      search("A");
      // "alpha", "beta" and "gamma" all contain an "a"; "LPH" only alpha.
      expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(3);
      search("LPH");
      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.queryByText("beta")).toBeNull();
      expect(screen.queryByText("gamma")).toBeNull();
    });

    it("ignores surrounding whitespace in the query", () => {
      renderList(searchable);
      search("  beta  ");
      expect(screen.getByText("beta")).toBeInTheDocument();
      expect(screen.queryByText("alpha")).toBeNull();
    });

    it("still addresses the right item when the view is filtered", () => {
      const onEdit = vi.fn();
      const { onDelete } = renderList({ ...searchable, onEdit });
      search("gamma");
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(onDelete).toHaveBeenCalledWith("c");
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(onEdit).toHaveBeenCalledWith("c");
    });

    it("hides the move controls while a filter is active", () => {
      renderList(searchable);
      search("a");
      expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Move down" })).toBeNull();
      search("");
      expect(screen.getAllByRole("button", { name: "Move up" })).toHaveLength(
        2,
      );
    });

    it("keeps the add control available while filtered", () => {
      const { onNewItem } = renderList(searchable);
      search("gamma");
      fireEvent.click(screen.getByRole("button", { name: "Add a thing" }));
      expect(onNewItem).toHaveBeenCalledOnce();
    });

    it("explains an empty result instead of showing a bare list", () => {
      renderList(searchable);
      search("nothing here");
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
      expect(
        screen.getByText('No things match "nothing here"'),
      ).toBeInTheDocument();
    });

    it("falls back to a generic noun in labels", () => {
      renderList({ getSearchText: searchable.getSearchText });
      expect(
        screen.getByRole("searchbox", { name: "Search items" }),
      ).toBeInTheDocument();
    });
  });

  describe("the query in the URL", () => {
    it("filters from the ?q= the page was opened with", () => {
      renderList({ ...searchable, entries: ["/things?q=beta"] });
      expect(
        screen.getByRole("searchbox", { name: "Search things" }),
      ).toHaveValue("beta");
      expect(screen.getByText("beta")).toBeInTheDocument();
      expect(screen.queryByText("alpha")).toBeNull();
    });

    it("writes what was typed to the URL", () => {
      const { router } = renderList(searchable);
      search("gam");
      expect(router.state.location.search).toBe("?q=gam");
    });

    it("drops ?q= entirely when the box is cleared", () => {
      const { router } = renderList({
        ...searchable,
        entries: ["/things?q=beta"],
      });
      search("");
      expect(router.state.location.search).toBe("");
    });

    it("leaves any other query parameter alone", () => {
      const { router } = renderList({
        ...searchable,
        entries: ["/things?ref=email"],
      });
      search("beta");
      expect(router.state.location.search).toBe("?ref=email&q=beta");
    });

    it("replaces history while typing, so back leaves the list", () => {
      const { router } = renderList({
        ...searchable,
        entries: ["/somewhere-else", "/things"],
      });
      search("b");
      search("be");
      search("bet");
      act(() => {
        void router.navigate(-1);
      });
      expect(router.state.location.pathname).toBe("/somewhere-else");
    });

    it("ignores ?q= when the list has no search box", () => {
      renderList({ entries: ["/things?q=beta"] });
      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("gamma")).toBeInTheDocument();
    });
  });

  describe("match count", () => {
    it("says how many of the items match", () => {
      renderList(searchable);
      search("beta");
      expect(screen.getByText("Showing 1 of 3 things")).toBeInTheDocument();
    });

    it("stays out of the way until something is searched for", () => {
      renderList(searchable);
      expect(screen.queryByText(/Showing/)).toBeNull();
    });

    it("leaves the count out when nothing matches", () => {
      renderList(searchable);
      search("nothing here");
      expect(screen.queryByText(/Showing/)).toBeNull();
      expect(
        screen.getByText('No things match "nothing here"'),
      ).toBeInTheDocument();
    });
  });

  // On a phone the row's controls turn from a column into a line of
  // circles, which is where the two halves of design brief §2 that colour
  // cannot carry come due: a destructive control has to be reachable
  // without precision, and must not be the closest thing to the action she
  // reaches for most. jsdom applies no stylesheet, so both are read from
  // the CSS rather than measured.
  // A list PAGE is a section of the admin like any other, and every other
  // one opens with a titled card: a heading naming where she is, then the
  // page's controls, with room around them. The lists opened with a bare
  // search field 13px under the top bar and named their section nowhere but
  // the sidebar highlight (#457, design brief §1).
  describe("the section heading", () => {
    it("names the section above the list", () => {
      renderList({ title: "Haiku" });
      expect(
        screen.getByRole("heading", { level: 2, name: "Haiku" }),
      ).toBeInTheDocument();
    });

    // Half a titled card is the defect: a heading floating above a search
    // field that still sits on its own is no less tight than before.
    it("gathers the search box, count and add button under it", () => {
      renderList({ title: "Things", ...searchable });
      search("a");
      const panel = screen.getByRole("heading", { level: 2 }).parentElement;
      expect(panel).toHaveClass("admin-data-list-header");
      const inPanel = within(panel as HTMLElement);
      expect(inPanel.getByRole("searchbox")).toBeInTheDocument();
      expect(inPanel.getByText(/^Showing /)).toBeInTheDocument();
      expect(
        inPanel.getByRole("button", { name: "Add a thing" }),
      ).toBeInTheDocument();
    });

    // The photography editor's image list. It already sits under that
    // editor's own heading, on that editor's card, so a second heading and
    // a second panel would announce a section she has not moved to.
    it("stays out of a list nested inside an editor", () => {
      renderList(searchable);
      expect(screen.queryByRole("heading")).toBeNull();
      expect(document.querySelector(".admin-data-list-header")).toBeNull();
    });

    // The point of the panel is the room, not the border: the heading has
    // to have at least as much space around it as a list row gives its own
    // content, or the page still reads as the tight one.
    it("is padded at least as generously as a list row", () => {
      expect(
        px(listCss, ".admin-data-list-header", "padding"),
      ).toBeGreaterThanOrEqual(px(listCss, ".admin-data-list-item", "padding"));
    });
  });

  describe("the row's shape", () => {
    // Edit and delete used to sit side by side on the compact lists (haiku,
    // haiga) and stacked vertically on the others (photography, other
    // works), so the same pair read as two different controls depending on
    // which section she was in. One direction, declared once, and no
    // variant allowed to flip it back.
    it("lays the controls out in a row on every list", () => {
      const directions = [
        ...listCss.matchAll(
          /([^{}]*admin-data-list-item-controls)\s*\{([^}]*)\}/g,
        ),
      ].map(([, , block]) => block.match(/flex-direction\s*:\s*(\w+)/)?.[1]);
      // Declared at least once, and never as a column by any variant.
      expect(directions).toContain("row");
      expect(directions).not.toContain("column");
    });

    // The buttons that act on a row belong with the row, not across a gap
    // of empty card from it — on a desktop the controls sat pinned to the
    // far right of a ~750px row with ~450px of nothing between. And the
    // labelled pair plus the move arrows is too wide to stand beside a
    // haiga's caption at any width (#457, design brief §1).
    it("gives the content a full line and the controls one below it", () => {
      expect(listCss).toMatch(
        /\.admin-data-list-item\s*\{[^}]*flex-wrap\s*:\s*wrap/,
      );
      expect(listCss).toMatch(
        /\.admin-data-list-item-content\s*\{[^}]*flex-basis\s*:\s*100%/,
      );
    });

    // Not a phone-only shape any more: the same crowding it fixed at 390px
    // is what the labelled controls create on a desktop.
    it("does so in the base rules, not only at phone width", () => {
      expect(atPhoneWidth).not.toMatch(/flex-basis\s*:\s*100%/);
    });

    // The list rows were the widest surface in the admin (800px) while the
    // other cards sit near 700px, so a list page read as a different room.
    it("holds a titled list to a narrower measure than an untitled one", () => {
      expect(px(listCss, ".admin-data-list.titled", "max-width")).toBeLessThan(
        px(listCss, ".admin-data-list", "max-width"),
      );
    });

    it("only marks a list titled when it has a title", () => {
      const { container } = renderList({ title: "Haiku" });
      expect(container.querySelector(".admin-data-list.titled")).not.toBeNull();
      const { container: nested } = renderList();
      expect(nested.querySelector(".admin-data-list.titled")).toBeNull();
    });
  });

  describe("the row controls at phone width", () => {
    // 44px: the size a touch target stops being a gamble at. Both shapes —
    // the arrows are circles, Edit and Delete are text buttons.
    it.each([
      [".admin-data-list-item-controls .admin-icon-button", "height"],
      [".admin-data-list-item-controls .admin-icon-button", "width"],
      [".admin-data-list-item-controls .admin-icon-button", "min-height"],
      [".admin-data-list-item-controls .admin-button", "min-height"],
    ])("gives %s a fingertip-sized %s", (selector, property) => {
      expect(px(atPhoneWidth, selector, property)).toBeGreaterThanOrEqual(44);
    });
  });

  describe("the destructive row control", () => {
    const DELETE = ".admin-data-list-item-controls .admin-button.danger-secondary";
    /** What the controls' own rhythm leaves between two neighbours. */
    const neighbourGap = px(
      listCss,
      ".admin-data-list-item-controls",
      "gap",
    ) + 2 * px(adminCss, ".admin-icon-button", "margin");

    // Colour and a word are not on their own enough: the brief asks that a
    // destructive action never be the closest thing to the one she reaches
    // for most (§2). At every width, not only on a phone — a mouse slip is
    // a slip too, and the separation is as much for the eye as for the
    // fingertip.
    it("sits further off than the controls sit from each other", () => {
      expect(px(listCss, DELETE, "margin-left")).toBeGreaterThan(neighbourGap);
    });

    it("is set apart by a base rule, not a phone-only one", () => {
      expect(atPhoneWidth).not.toMatch(/danger-secondary\s*\{[^}]*margin-left/);
    });
  });
});
