import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HaigaEditor } from "./haiga-editor";
import { Haiga } from "../../../../../Models";

const haiga: Haiga = {
  id: "g1",
  lines: ["line one", "line two", "line three"],
  image: "",
  publisher: "kari",
};

function renderEditor(overrides?: {
  validate?: (haiga: Haiga) => boolean;
}) {
  const setHaiga = vi.fn();
  const setImageFile = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const validate = overrides?.validate ?? (() => true);
  const utils = render(
    <HaigaEditor
      haiga={haiga}
      setHaiga={setHaiga}
      validate={validate}
      imageFile={null}
      setImageFile={setImageFile}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { ...utils, setHaiga, setImageFile, onSave, onClose };
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

describe("HaigaEditor", () => {
  it("shows the haiga lines joined into the textarea", () => {
    renderEditor();
    const textArea = screen.getByPlaceholderText(/line 1/);
    expect(textArea).toHaveValue("line one\nline two\nline three");
  });

  it("splits textarea edits back into lines", () => {
    const { setHaiga } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText(/line 1/), {
      target: { value: "a\nb\nc" },
    });
    expect(setHaiga).toHaveBeenCalledWith({
      ...haiga,
      lines: ["a", "b", "c"],
    });
  });

  it("updates the publisher while keeping the rest of the haiga", () => {
    const { setHaiga } = renderEditor();
    fireEvent.change(screen.getByPlaceholderText("Publisher"), {
      target: { value: "issa" },
    });
    expect(setHaiga).toHaveBeenCalledWith({ ...haiga, publisher: "issa" });
  });

  it("passes a selected image file up through setImageFile", () => {
    const { container, setImageFile } = renderEditor();
    const file = new File(["img"], "photo.png", { type: "image/png" });

    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [file] },
    });

    expect(setImageFile).toHaveBeenCalledWith(file);
  });

  it("prompts to select an image when none is chosen yet", () => {
    renderEditor();
    expect(screen.getByText("Select Image")).toBeInTheDocument();
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
