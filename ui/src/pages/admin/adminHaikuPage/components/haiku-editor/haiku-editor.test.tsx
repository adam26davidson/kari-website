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

function renderEditor(overrides?: { saveDisabled?: boolean }) {
  const setHaiku = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <HaikuEditor
      haiku={haiku}
      setHaiku={setHaiku}
      onSave={onSave}
      onClose={onClose}
      saveDisabled={overrides?.saveDisabled ?? false}
    />,
  );
  return { ...utils, setHaiku, onSave, onClose };
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
    const { onSave, onClose } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables the save button when the page says so", () => {
    renderEditor({ saveDisabled: true });
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "disabled",
    );
  });
});
