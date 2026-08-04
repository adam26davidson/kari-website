import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HaikuEditor } from "./haiku-editor";
import { Haiku } from "../../../../../Models";

const haiku: Haiku = {
  id: "h1",
  lines: ["line one", "line two", "line three"],
  publisher: "kari",
};

function renderEditor(overrides?: {
  validate?: (haiku: Haiku) => boolean;
}) {
  const setHaiku = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const validate = overrides?.validate ?? (() => true);
  const utils = render(
    <HaikuEditor
      haiku={haiku}
      setHaiku={setHaiku}
      onSave={onSave}
      onClose={onClose}
      validate={validate}
    />,
  );
  return { ...utils, setHaiku, onSave, onClose };
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

describe("HaikuEditor", () => {
  it("shows the haiku lines joined into the textarea", () => {
    renderEditor();
    const textArea = screen.getByPlaceholderText(/line 1/);
    expect(textArea).toHaveValue("line one\nline two\nline three");
  });

  it("splits textarea edits back into lines", () => {
    const { setHaiku } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText(/line 1/), {
      target: { value: "a\nb\nc" },
    });
    expect(setHaiku).toHaveBeenCalledWith({
      ...haiku,
      lines: ["a", "b", "c"],
    });
  });

  it("updates the publisher while keeping the lines", () => {
    const { setHaiku } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("Publisher"), {
      target: { value: "basho" },
    });
    expect(setHaiku).toHaveBeenCalledWith({ ...haiku, publisher: "basho" });
  });

  it("saves and closes through the editor controls", async () => {
    const { container, onSave, onClose } = renderEditor();

    await userEvent.click(iconButton(container, "floppy-disk"));
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.click(iconButton(container, "xmark"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables the save button when validation fails", () => {
    const { container } = renderEditor({ validate: () => false });
    expect(iconButton(container, "floppy-disk")).toHaveClass("disabled");
  });
});
