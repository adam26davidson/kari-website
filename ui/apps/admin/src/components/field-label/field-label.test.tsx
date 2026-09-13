import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldLabel } from "./field-label";

describe("FieldLabel", () => {
  it("names the control its htmlFor points at", () => {
    render(
      <>
        <FieldLabel htmlFor="title-field">Title</FieldLabel>
        <input id="title-field" type="text" />
      </>,
    );

    expect(screen.getByLabelText("Title")).toBe(screen.getByRole("textbox"));
  });

  it("names a group with a span, so it claims no control of its own", () => {
    render(
      <>
        <FieldLabel>Images</FieldLabel>
        <input type="text" />
      </>,
    );

    // A <label> with no `for` names whatever input it wraps or follows in
    // some browsers' heuristics; a <span> cannot, which is the point.
    expect(screen.getByText("Images").tagName).toBe("SPAN");
    expect(screen.getByRole("textbox")).toHaveAccessibleName("");
  });

  it("sets a field's name in Ink rather than the muted tone", () => {
    render(<FieldLabel htmlFor="anything">Publisher</FieldLabel>);

    const label = screen.getByText("Publisher");
    // The boards render the label the same colour as the value it leads
    // (`WorksEditor.png`: `#2A2723`). `text-muted-foreground` here is what
    // #237's visual review read as the editors looking unfinished.
    expect(label).toHaveClass("text-foreground");
    expect(label).toHaveClass("font-medium");
    expect(label).not.toHaveClass("text-muted-foreground");
  });

  it("takes a caller's classes alongside its own", () => {
    render(
      <FieldLabel className="cursor-pointer" htmlFor="published">
        Published
      </FieldLabel>,
    );

    const label = screen.getByText("Published");
    expect(label).toHaveClass("cursor-pointer");
    expect(label).toHaveClass("text-foreground");
  });
});
