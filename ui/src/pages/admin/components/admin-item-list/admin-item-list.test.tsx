import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AdminItemList } from "./admin-item-list";

const items = [
  { id: "a", name: "alpha" },
  { id: "b", name: "beta" },
  { id: "c", name: "gamma" },
];

function renderList(overrides?: {
  onEdit?: (id: string) => void;
  hideEdit?: boolean;
  compact?: boolean;
  getSearchText?: (item: { id: string; name: string }) => string;
  noun?: string;
}) {
  const onNewItem = vi.fn();
  const onDelete = vi.fn();
  const onMove = vi.fn();
  const utils = render(
    <AdminItemList
      items={items}
      onNewItem={onNewItem}
      onDelete={onDelete}
      onMove={onMove}
      onEdit={overrides?.onEdit}
      hideEdit={overrides?.hideEdit}
      compact={overrides?.compact}
      getSearchText={overrides?.getSearchText}
      noun={overrides?.noun}
      renderItem={(item) => <span>{item.name}</span>}
    />,
  );
  return { ...utils, onNewItem, onDelete, onMove };
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

  it("fires onNewItem from the add control", () => {
    const { onNewItem } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Add item" }));
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
});
