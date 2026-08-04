import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataListItem from "./dataListItem";

function iconButton(container: HTMLElement, icon: string): HTMLElement {
  const svg = container.querySelector(`svg[data-icon="${icon}"]`);
  const button = svg?.closest(".admin-icon-button");
  if (!(button instanceof HTMLElement)) {
    throw new Error(`no icon button for "${icon}"`);
  }
  return button;
}

function hasIcon(container: HTMLElement, icon: string): boolean {
  return container.querySelector(`svg[data-icon="${icon}"]`) !== null;
}

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
    const { container } = render(
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

    await userEvent.click(iconButton(container, "arrow-up"));
    await userEvent.click(iconButton(container, "arrow-down"));
    await userEvent.click(iconButton(container, "trash"));
    await userEvent.click(iconButton(container, "pencil"));

    expect(onMoveUp).toHaveBeenCalledOnce();
    expect(onMoveDown).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("hides move-up on the first item and move-down on the last", () => {
    const { container: first } = render(
      <DataListItem isAdmin={true} isFirst={true} isLast={false} />,
    );
    expect(hasIcon(first, "arrow-up")).toBe(false);
    expect(hasIcon(first, "arrow-down")).toBe(true);

    const { container: last } = render(
      <DataListItem isAdmin={true} isFirst={false} isLast={true} />,
    );
    expect(hasIcon(last, "arrow-up")).toBe(true);
    expect(hasIcon(last, "arrow-down")).toBe(false);
  });

  it("hides the edit button when hideEdit is set", () => {
    const { container } = render(
      <DataListItem isAdmin={true} isFirst={true} isLast={true} hideEdit />,
    );
    expect(hasIcon(container, "pencil")).toBe(false);
    expect(hasIcon(container, "trash")).toBe(true);
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
