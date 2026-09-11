import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ItemList } from "./item-list";

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
  items?: Array<{ id: string; name: string }>;
  entries?: Array<string>;
}) {
  const onNewItem = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onMove = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: "/things",
        element: (
          <ItemList
            items={overrides?.items ?? items}
            title="Things"
            noun="things"
            addLabel="Add a thing"
            getSearchText={(item) => item.name}
            onNewItem={onNewItem}
            onEdit={onEdit}
            onDelete={onDelete}
            onMove={onMove}
            renderItem={(item) => <span>{item.name}</span>}
          />
        ),
      },
      { path: "*", element: <p>elsewhere</p> },
    ],
    { initialEntries: overrides?.entries ?? ["/things"] },
  );
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, onNewItem, onEdit, onDelete, onMove, router };
}

const search = (query: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: "Search things" }), {
    target: { value: query },
  });

describe("ItemList", () => {
  it("names the section and renders every item through renderItem", () => {
    renderList();

    expect(
      screen.getByRole("heading", { level: 2, name: "Things" }),
    ).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });

  it("offers the add control by name and fires onNewItem from it", () => {
    const { onNewItem } = renderList();

    fireEvent.click(screen.getByRole("button", { name: "Add a thing" }));

    expect(onNewItem).toHaveBeenCalledOnce();
  });

  // The mobile board puts the search and Add above the card while the
  // desktop board puts them in its header row. That has to be one DOM tree
  // with responsive classes: a second copy behind a breakpoint would make
  // `getByRole` ambiguous here and trip the e2e journeys' strict mode.
  it("renders exactly one search box and one add button", () => {
    renderList();

    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add a thing" })).toHaveLength(
      1,
    );
  });

  // Edit (the one she reaches for most) first, delete last and in the
  // danger maroon, with the arrows between them (#457, design brief §2).
  it("puts edit first and delete last in each row's controls", () => {
    const { container } = renderList();

    // The middle row: it has all four controls (both move directions).
    const row = container.querySelectorAll(".admin-data-list-item")[1];
    const names = within(row as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.textContent || button.getAttribute("aria-label"));

    expect(names).toEqual(["Edit", "Move up", "Move down", "Delete"]);
  });

  // The admin's one user does not read icons as vocabulary, and the words
  // survive where a pencil-in-a-circle did not (#457, design brief §3).
  it("says what the two consequential controls do, in a word", () => {
    renderList();

    for (const name of ["Edit", "Delete"]) {
      const buttons = screen.getAllByRole("button", { name });
      expect(buttons).toHaveLength(items.length);
      expect(buttons[0]).toHaveTextContent(name);
      expect(buttons[0]).not.toHaveAttribute("aria-label");
    }
  });

  // Colour and a word are not on their own enough: the brief asks that a
  // destructive action never be the closest thing to the one she reaches
  // for most (§2). The legacy fork said this in a margin rule in its
  // stylesheet; migrated, the row states it in the markup, so this is
  // where it is pinned.
  it("sets delete further off than the controls sit from each other", () => {
    renderList();

    const remove = screen.getAllByRole("button", { name: "Delete" })[0];
    expect(remove).toHaveClass("ml-4");
    expect(remove.parentElement).toHaveClass("gap-2");
  });

  it.each([
    ["onEdit", "Edit"],
    ["onDelete", "Delete"],
  ])("fires %s with the item's id", (callback, name) => {
    const handlers = renderList();

    fireEvent.click(screen.getAllByRole("button", { name })[2]);

    expect(handlers[callback as "onEdit" | "onDelete"]).toHaveBeenCalledWith(
      "c",
    );
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

    // The first "Move down" belongs to item a; the last "Move up" to c.
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    expect(onMove).toHaveBeenCalledWith("a", "down");

    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    expect(onMove).toHaveBeenCalledWith("c", "up");
  });

  describe("search", () => {
    it("filters items by case-insensitive substring, keeping order", () => {
      renderList();

      search("A");
      // "alpha", "beta" and "gamma" all contain an "a"; "LPH" only alpha.
      expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(3);

      search("LPH");
      expect(screen.getByText("alpha")).toBeInTheDocument();
      expect(screen.queryByText("beta")).toBeNull();
      expect(screen.queryByText("gamma")).toBeNull();
    });

    it("ignores surrounding whitespace in the query", () => {
      renderList();

      search("  beta  ");

      expect(screen.getByText("beta")).toBeInTheDocument();
      expect(screen.queryByText("alpha")).toBeNull();
    });

    // The rendered list is a subset, so an index into it would address the
    // wrong element of the page's full list.
    it("still addresses the right item when the view is filtered", () => {
      const { onDelete, onEdit } = renderList();

      search("gamma");

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(onDelete).toHaveBeenCalledWith("c");
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(onEdit).toHaveBeenCalledWith("c");
    });

    // "Up" is meaningless relative to a partial view.
    it("hides the move controls while a filter is active", () => {
      renderList();

      search("a");
      expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Move down" })).toBeNull();

      search("");
      expect(screen.getAllByRole("button", { name: "Move up" })).toHaveLength(
        2,
      );
    });

    it("keeps the add control available while filtered", () => {
      const { onNewItem } = renderList();

      search("gamma");
      fireEvent.click(screen.getByRole("button", { name: "Add a thing" }));

      expect(onNewItem).toHaveBeenCalledOnce();
    });

    it("says how many of the items match", () => {
      renderList();

      search("beta");

      expect(screen.getByText("Showing 1 of 3 things")).toBeInTheDocument();
    });

    it("keeps the count out of the way until something is searched for", () => {
      renderList();

      expect(screen.queryByText(/Showing/)).toBeNull();
    });

    it("leaves the count out when nothing matches", () => {
      renderList();

      search("nothing here");

      expect(screen.queryByText(/Showing/)).toBeNull();
    });
  });

  // Two ways for the list to come up empty, and they want opposite answers
  // (#473, design brief §7).
  describe("a list with nothing to show", () => {
    it("invites the first one instead of showing a bare gap", () => {
      renderList({ items: [] });

      expect(
        screen.getByText("No things yet. Add your first one."),
      ).toBeInTheDocument();
      // The invitation is not a dead end: the action it names is right
      // there (design brief §7, §8).
      expect(
        screen.getByRole("button", { name: "Add a thing" }),
      ).toBeInTheDocument();
    });

    it("stays out of the way as soon as there is something to show", () => {
      renderList();

      expect(screen.queryByText(/yet\./)).toBeNull();
    });

    // With nothing in the section there is nothing a query could have
    // missed, so blaming the search would send her looking for a spelling
    // mistake instead of telling her the section is empty.
    it("says the section is empty rather than blaming the search", () => {
      renderList({ items: [] });

      search("beta");

      expect(
        screen.getByText("No things yet. Add your first one."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/match/)).toBeNull();
    });

    it("leaves an unmatched query to the search notice once there are items", () => {
      renderList();

      search("nothing here");

      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
      expect(
        screen.getByText('No things match "nothing here"'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/yet\./)).toBeNull();
    });
  });

  describe("the query in the URL", () => {
    it("filters from the ?q= the page was opened with", () => {
      renderList({ entries: ["/things?q=beta"] });

      expect(
        screen.getByRole("searchbox", { name: "Search things" }),
      ).toHaveValue("beta");
      expect(screen.getByText("beta")).toBeInTheDocument();
      expect(screen.queryByText("alpha")).toBeNull();
    });

    it("writes what was typed to the URL", () => {
      const { router } = renderList();

      search("gam");

      expect(router.state.location.search).toBe("?q=gam");
    });

    it("drops ?q= entirely when the box is cleared", () => {
      const { router } = renderList({ entries: ["/things?q=beta"] });

      search("");

      expect(router.state.location.search).toBe("");
    });

    it("leaves any other query parameter alone", () => {
      const { router } = renderList({ entries: ["/things?ref=email"] });

      search("beta");

      expect(router.state.location.search).toBe("?ref=email&q=beta");
    });

    it("replaces history while typing, so back leaves the list", () => {
      const { router } = renderList({
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
  });

  // Neither of these is decoration, and neither is visible to any other
  // test here. The class is how e2e/helpers.ts locates a row; the
  // data-slot is how admin.css and admin-item-list.css opt OUT of styling
  // it, and without it the row renders half-legacy (#234).
  it("keeps the e2e row hook and the stylesheets' opt-out on every row", () => {
    const { container } = renderList();

    const rows = container.querySelectorAll(".admin-data-list-item");
    expect(rows).toHaveLength(items.length);
    for (const row of rows) {
      expect(row).toHaveAttribute("data-slot", "list-row");
    }
  });
});
