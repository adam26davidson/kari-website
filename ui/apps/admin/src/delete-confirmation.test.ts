import { describe, it, expect } from "vitest";
import { deleteConfirmationMessage } from "./delete-confirmation";

describe("deleteConfirmationMessage", () => {
  it("names the item being deleted", () => {
    expect(deleteConfirmationMessage("haiku", "Autumn rain")).toBe(
      'Delete the haiku "Autumn rain"?',
    );
  });

  it("uses the first candidate that has text", () => {
    expect(deleteConfirmationMessage("haiku", "", "   ", "old pond")).toBe(
      'Delete the haiku "old pond"?',
    );
  });

  it("collapses whitespace inside a name so the dialog stays one line", () => {
    expect(
      deleteConfirmationMessage("photography post", "  Winter\n  light  "),
    ).toBe('Delete the photography post "Winter light"?');
  });

  it("falls back to an untitled wording when nothing names the item", () => {
    expect(deleteConfirmationMessage("haiga")).toBe(
      "Delete this untitled haiga?",
    );
    expect(deleteConfirmationMessage("other works item", undefined, " ")).toBe(
      "Delete this untitled other works item?",
    );
  });

  it("shortens a long name rather than filling the dialog with it", () => {
    const name = `${"a".repeat(59)} tail end`;

    const message = deleteConfirmationMessage("other works item", name);

    expect(message).toBe(`Delete the other works item "${"a".repeat(59)}..."?`);
  });

  it("leaves a name at the length limit intact", () => {
    const name = "b".repeat(60);

    expect(deleteConfirmationMessage("haiku", name)).toBe(
      `Delete the haiku "${name}"?`,
    );
  });
});
