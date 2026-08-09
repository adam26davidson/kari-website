import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AdminItemList } from "./admin-item-list";

const items = [
  { id: "a", name: "alpha" },
  { id: "b", name: "beta" },
  { id: "c", name: "gamma" },
];

function renderList(overrides?: {
  onEdit?: (idx: number) => void;
  hideEdit?: boolean;
  compact?: boolean;
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
      renderItem={(item, idx) => (
        <span>
          {item.name}-{idx}
        </span>
      )}
    />,
  );
  return { ...utils, onNewItem, onDelete, onMove };
}

describe("AdminItemList", () => {
  it("renders every item through renderItem with its index", () => {
    renderList();
    expect(screen.getByText("alpha-0")).toBeInTheDocument();
    expect(screen.getByText("beta-1")).toBeInTheDocument();
    expect(screen.getByText("gamma-2")).toBeInTheDocument();
  });

  it("fires onNewItem from the add control", () => {
    const { onNewItem } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(onNewItem).toHaveBeenCalledOnce();
  });

  it("fires onDelete with the item's index", () => {
    const { onDelete } = renderList();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("fires onEdit with the item's index", () => {
    const onEdit = vi.fn();
    renderList({ onEdit });
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[2]);
    expect(onEdit).toHaveBeenCalledWith(2);
  });

  it("omits move-up on the first item and move-down on the last", () => {
    renderList();
    // Items 1 and 2 can move up; items 0 and 1 can move down.
    expect(screen.getAllByRole("button", { name: "Move up" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Move down" })).toHaveLength(
      2,
    );
  });

  it("fires onMove with the index and direction", () => {
    const { onMove } = renderList();
    // The first "Move down" belongs to item 0; the last "Move up" to
    // item 2.
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    expect(onMove).toHaveBeenCalledWith(0, "down");
    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    expect(onMove).toHaveBeenCalledWith(2, "up");
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
});
