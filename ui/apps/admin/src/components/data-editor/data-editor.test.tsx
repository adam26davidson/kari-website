import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataEditor } from "./data-editor";

// jsdom applies no stylesheet, so the card's spacing is read out of the CSS
// rather than measured.
const editorCss = readFileSync(
  "src/pages/admin/components/data-editor/data-editor.css",
  "utf-8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function renderEditor(overrides?: { disableSave?: boolean }) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <DataEditor
      title="Edit haiku"
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
  it("names what is being edited in a heading", () => {
    renderEditor();
    expect(
      screen.getByRole("heading", { name: "Edit haiku" }),
    ).toBeInTheDocument();
  });

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

  // The panel's bottom edge is the one a reviewer reads as "cut off": the
  // last field is a filled box, so any shortfall between it and the card's
  // rim is visible in a way the airy top is not. One shorthand value keeps
  // all four sides equal by construction, and 24px is what every other
  // admin panel spends (the list page's titled header, image cleanup,
  // what's on test) -- this card used to be the tightest of them at 20px.
  it("pads the card equally on all four sides, as generously as the other admin panels", () => {
    const rule = editorCss.match(/\.data-editor-content\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const padding = rule![1].match(/(?:^|;)\s*padding\s*:\s*([^;]+)/);
    expect(padding).not.toBeNull();
    const sides = padding![1].trim().split(/\s+/);
    expect(sides).toHaveLength(1);
    expect(Number(sides[0].replace("px", ""))).toBeGreaterThanOrEqual(24);
    // And no narrow-viewport override takes it back: tablet and phone are
    // exactly where the shortfall was reported.
    expect(editorCss.slice(editorCss.indexOf("@media"))).not.toMatch(
      /\.data-editor-content\s*\{[^}]*padding/,
    );
  });
});
