import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HaigaEditor } from "./haiga-editor";
import { Haiga } from "@kari/shared/models";

const haiga: Haiga = {
  id: "g1",
  lines: [],
  image: "",
  publisher: "kari",
};

function renderEditor(overrides?: { saveDisabled?: boolean }) {
  const setHaiga = vi.fn();
  const setImageFile = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <HaigaEditor
      haiga={haiga}
      setHaiga={setHaiga}
      saveDisabled={overrides?.saveDisabled ?? false}
      imageFile={null}
      setImageFile={setImageFile}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { ...utils, setHaiga, setImageFile, onSave, onClose };
}

describe("HaigaEditor", () => {
  it("updates the publisher while keeping the rest of the haiga", () => {
    const { setHaiga } = renderEditor();
    fireEvent.change(screen.getByLabelText("Publisher"), {
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
    expect(screen.getByText("Select an image")).toBeInTheDocument();
  });

  it("saves and closes through the editor controls", async () => {
    const { onSave, onClose } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables the save button when the page says so", () => {
    renderEditor({ saveDisabled: true });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says what it is editing and names both fields", () => {
    renderEditor();
    expect(
      screen.getByRole("heading", { name: "Edit haiga" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Image")).toBeInTheDocument();
    expect(screen.getByLabelText("Publisher")).toHaveValue("kari");
  });
});
