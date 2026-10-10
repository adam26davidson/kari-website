import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorPage } from "./editor-page";

function renderEditor(overrides?: {
  disableSave?: boolean;
  preview?: React.ReactNode;
}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <EditorPage
      title="Edit haiku"
      onSave={onSave}
      onClose={onClose}
      disableSave={overrides?.disableSave}
      preview={overrides?.preview}
    >
      <p>the fields</p>
    </EditorPage>,
  );
  return { ...utils, onSave, onClose };
}

describe("EditorPage", () => {
  it("says what is being edited and shows the fields on a card", () => {
    renderEditor();

    expect(
      screen.getByRole("heading", { level: 2, name: "Edit haiku" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("the fields").closest('[data-slot="card"]'),
    ).not.toBeNull();
  });

  it("saves and closes through its two controls", async () => {
    const { onSave, onClose } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables save when the page says the content is not saveable", () => {
    renderEditor({ disableSave: true });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    // Close is never disabled: no dead ends (design brief §8).
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  });

  it("leaves save enabled by default", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  // The two class hooks are how the admin e2e journeys find an open editor
  // and its Save/Close pair, and the two data-slots are shadcn's slot
  // markers, which those journeys also locate by. Neither is decoration,
  // and both are invisible to every other test here — so they are pinned.
  it("keeps the e2e hooks and the slot markers the pair depends on", () => {
    const { container } = renderEditor();

    const root = container.querySelector(".data-editor");
    expect(root).toHaveAttribute("data-slot", "editor");

    const controls = container.querySelector(".data-editor-item-controls");
    expect(controls).toHaveAttribute("data-slot", "editor-controls");
    expect(root).toContainElement(controls as HTMLElement);
  });

  // The site preview card (#859) sits below the fields card. Below, not
  // above: the e2e journeys find the fields card as the FIRST card in the
  // editor, and the preview is a card too.
  it("renders the preview after the fields card", () => {
    renderEditor({ preview: <p>the preview</p> });

    const card = screen.getByText("the fields").closest('[data-slot="card"]');
    const preview = screen.getByText("the preview");
    expect(card).not.toContainElement(preview);
    expect(
      card!.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no preview unless given one", () => {
    const { container } = renderEditor();
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
  });
});
