import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
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
  onEdit?: (id: string) => void;
  hideEdit?: boolean;
  compact?: boolean;
  getSearchText?: (item: { id: string; name: string }) => string;
  noun?: string;
  entries?: Array<string>;
}) {
  const onNewItem = vi.fn();
  const onDelete = vi.fn();
  const onMove = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: "/admin/things",
        element: (
          <AdminItemList
            items={items}
            addLabel="Add a thing"
            onNewItem={onNewItem}
            onDelete={onDelete}
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
    { initialEntries: overrides?.entries ?? ["/admin/things"] },
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
    const labels = within(row as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["Edit", "Move up", "Move down", "Delete"]);
  });

  it("dresses delete as the destructive control it is", () => {
    renderList();
    for (const button of screen.getAllByRole("button", { name: "Delete" })) {
      expect(button).toHaveClass("danger");
    }
    // The non-destructive controls emphatically do not.
    for (const button of screen.getAllByRole("button", { name: "Move up" })) {
      expect(button).not.toHaveClass("danger");
    }
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
      renderList({ ...searchable, entries: ["/admin/things?q=beta"] });
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
        entries: ["/admin/things?q=beta"],
      });
      search("");
      expect(router.state.location.search).toBe("");
    });

    it("leaves any other query parameter alone", () => {
      const { router } = renderList({
        ...searchable,
        entries: ["/admin/things?ref=email"],
      });
      search("beta");
      expect(router.state.location.search).toBe("?ref=email&q=beta");
    });

    it("replaces history while typing, so back leaves the list", () => {
      const { router } = renderList({
        ...searchable,
        entries: ["/somewhere-else", "/admin/things"],
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
      renderList({ entries: ["/admin/things?q=beta"] });
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
});
