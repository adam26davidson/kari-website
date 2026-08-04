import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataEditor } from "./data-editor";

function renderEditor(overrides?: { disableSave?: boolean }) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <DataEditor
      disableSave={overrides?.disableSave}
      onSave={onSave}
      onClose={onClose}
    >
      <span>editor content</span>
    </DataEditor>,
  );
  return { ...utils, onSave, onClose };
}

function iconButton(container: HTMLElement, icon: string): HTMLElement {
  const button = container
    .querySelector(`svg[data-icon="${icon}"]`)
    ?.closest(".admin-icon-button");
  if (!(button instanceof HTMLElement)) {
    throw new Error(`no icon button for "${icon}"`);
  }
  return button;
}

describe("DataEditor", () => {
  it("renders its children", () => {
    renderEditor();
    expect(screen.getByText("editor content")).toBeInTheDocument();
  });

  it("calls onSave when the enabled save button is clicked", async () => {
    const { container, onSave } = renderEditor({ disableSave: false });
    await userEvent.click(iconButton(container, "floppy-disk"));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("does not call onSave when the disabled save button is clicked", async () => {
    const { container, onSave } = renderEditor({ disableSave: true });
    const save = iconButton(container, "floppy-disk");
    expect(save).toHaveClass("disabled");
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onClose when the close button is clicked", async () => {
    const { container, onClose } = renderEditor();
    await userEvent.click(iconButton(container, "xmark"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
