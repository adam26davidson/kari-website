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

describe("DataEditor", () => {
  it("renders its children", () => {
    renderEditor();
    expect(screen.getByText("editor content")).toBeInTheDocument();
  });

  it("calls onSave when the enabled save button is clicked", async () => {
    const { onSave } = renderEditor({ disableSave: false });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("does not call onSave when the disabled save button is clicked", async () => {
    const { onSave } = renderEditor({ disableSave: true });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toHaveClass("disabled");
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onClose when the close button is clicked", async () => {
    const { onClose } = renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("activates the close button from the keyboard", async () => {
    const { onClose } = renderEditor();
    screen.getByRole("button", { name: "Close" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
