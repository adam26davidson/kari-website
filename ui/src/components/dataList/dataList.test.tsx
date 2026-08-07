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
    const { onNewItem } = renderList(true);

    const addButton = screen.getByRole("button", { name: "Add item" });
    await userEvent.click(addButton);
    expect(onNewItem).toHaveBeenCalledOnce();
  });

  it("hides the add button outside admin mode", () => {
    renderList(false);
    expect(
      screen.queryByRole("button", { name: "Add item" }),
    ).not.toBeInTheDocument();
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

  it("lets a child's key govern reconciliation across reorders", async () => {
    const items = (order: string[]) =>
      order.map((id) => (
        <input key={id} aria-label={`input-${id}`} defaultValue="" />
      ));
    const { rerender } = render(
      <DataList isAdmin={false} onNewItem={vi.fn()}>
        {items(["a", "b"])}
      </DataList>,
    );

    await userEvent.type(screen.getByLabelText("input-a"), "typed into a");

    rerender(
      <DataList isAdmin={false} onNewItem={vi.fn()}>
        {items(["b", "a"])}
      </DataList>,
    );

    // The uncontrolled input's DOM state travels with the keyed child
    // instead of sticking to its list position.
    expect(screen.getByLabelText("input-a")).toHaveValue("typed into a");
    expect(screen.getByLabelText("input-b")).toHaveValue("");
  });

  it("falls back to index keys for unkeyed element children", () => {
    // Passing unkeyed elements in an array is the condition under test, so
    // React's "unique key" warning is expected here — silence it to keep
    // the test output free of key warnings.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      render(
        <DataList isAdmin={false} onNewItem={vi.fn()}>
          {[<span>unkeyed first</span>, <span>unkeyed second</span>]}
        </DataList>,
      );
      expect(screen.getByText("unkeyed first")).toBeInTheDocument();
      expect(screen.getByText("unkeyed second")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("falls back to index keys for non-element children", () => {
    render(
      <DataList isAdmin={false} onNewItem={vi.fn()}>
        {["plain text one", "plain text two"]}
      </DataList>,
    );
    expect(screen.getByText(/plain text one/)).toBeInTheDocument();
    expect(screen.getByText(/plain text two/)).toBeInTheDocument();
  });
});
