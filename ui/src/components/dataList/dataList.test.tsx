import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataList from "./dataList";

function renderList(isAdmin: boolean, onNewItem = vi.fn()) {
  const utils = render(
    <DataList isAdmin={isAdmin} onNewItem={onNewItem}>
      {[<span key="a">first</span>, <span key="b">second</span>]}
    </DataList>,
  );
  return { ...utils, onNewItem };
}

describe("DataList", () => {
  it("renders all children", () => {
    renderList(false);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("shows an add button in admin mode that fires onNewItem", async () => {
    const { container, onNewItem } = renderList(true);

    const addButton = container.querySelector(".admin-icon-button");
    expect(addButton).toBeInTheDocument();

    await userEvent.click(addButton as HTMLElement);
    expect(onNewItem).toHaveBeenCalledOnce();
  });

  it("hides the add button outside admin mode", () => {
    const { container } = renderList(false);
    expect(container.querySelector(".admin-icon-button")).toBeNull();
  });

  it("separates items in the public view but not after the last", () => {
    const { container } = renderList(false);
    const separators = container.querySelectorAll(
      ".data-list-item-separator",
    );
    expect(separators).toHaveLength(1);
  });

  it("omits separators in admin mode", () => {
    const { container } = renderList(true);
    expect(container.querySelector(".data-list-item-separator")).toBeNull();
  });
});
