import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataListItem } from "./data-list-item";

describe("DataListItem", () => {
  it("renders children without admin controls in the public view", () => {
    const { container } = render(
      <DataListItem isAdmin={false} isFirst={false} isLast={false}>
        <span>content</span>
      </DataListItem>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(container.querySelector(".data-list-item-controls")).toBeNull();
  });

  it("fires the move, delete and edit callbacks in admin mode", async () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    render(
      <DataListItem
        isAdmin={true}
        isFirst={false}
        isLast={false}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={onDelete}
        onEdit={onEdit}
      >
        <span>content</span>
      </DataListItem>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Move up" }));
    await userEvent.click(screen.getByRole("button", { name: "Move down" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(onMoveUp).toHaveBeenCalledOnce();
    expect(onMoveDown).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("supports keyboard activation of the admin controls", async () => {
    const onDelete = vi.fn();
    render(
      <DataListItem
        isAdmin={true}
        isFirst={true}
        isLast={true}
        onDelete={onDelete}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    await userEvent.tab();
    expect(deleteButton).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("hides move-up on the first item and move-down on the last", () => {
    const first = within(
      render(<DataListItem isAdmin={true} isFirst={true} isLast={false} />)
        .container,
    );
    expect(
      first.queryByRole("button", { name: "Move up" }),
    ).not.toBeInTheDocument();
    expect(
      first.getByRole("button", { name: "Move down" }),
    ).toBeInTheDocument();

    const last = within(
      render(<DataListItem isAdmin={true} isFirst={false} isLast={true} />)
        .container,
    );
    expect(last.getByRole("button", { name: "Move up" })).toBeInTheDocument();
    expect(
      last.queryByRole("button", { name: "Move down" }),
    ).not.toBeInTheDocument();
  });

  it("hides the edit button when hideEdit is set", () => {
    render(
      <DataListItem isAdmin={true} isFirst={true} isLast={true} hideEdit />,
    );
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("applies the compact admin style when requested", () => {
    const { container } = render(
      <DataListItem isAdmin={true} isFirst={true} isLast={true} compact />,
    );
    expect(
      container.querySelector(".admin-data-list-item.compact"),
    ).toBeInTheDocument();
  });
});
