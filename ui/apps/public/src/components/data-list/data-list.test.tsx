import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataList } from "./data-list";

function renderList() {
  return render(
    <DataList>
      {[<span key="a">first</span>, <span key="b">second</span>]}
    </DataList>,
  );
}

describe("DataList", () => {
  it("renders all children", () => {
    renderList();
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("renders a single, non-array child as the card with no separator", () => {
    // The blog permalink page puts one OtherWorksItem in the card.
    const { container } = render(
      <DataList>
        <span>only</span>
      </DataList>,
    );
    expect(screen.getByText("only")).toBeInTheDocument();
    expect(container.querySelector(".data-list")).not.toBeNull();
    expect(
      container.querySelectorAll(".data-list-item-separator"),
    ).toHaveLength(0);
  });

  it("separates items but not after the last", () => {
    const { container } = renderList();
    const separators = container.querySelectorAll(
      ".data-list-item-separator",
    );
    expect(separators).toHaveLength(1);
  });

  it("lets a child's key govern reconciliation across reorders", async () => {
    const items = (order: string[]) =>
      order.map((id) => (
        <input key={id} aria-label={`input-${id}`} defaultValue="" />
      ));
    const { rerender } = render(<DataList>{items(["a", "b"])}</DataList>);

    await userEvent.type(screen.getByLabelText("input-a"), "typed into a");

    rerender(<DataList>{items(["b", "a"])}</DataList>);

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
        <DataList>
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
    render(<DataList>{["plain text one", "plain text two"]}</DataList>);
    expect(screen.getByText(/plain text one/)).toBeInTheDocument();
    expect(screen.getByText(/plain text two/)).toBeInTheDocument();
  });
});
