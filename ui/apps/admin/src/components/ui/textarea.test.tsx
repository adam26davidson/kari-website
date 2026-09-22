import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("is a controlled textarea that reports what was typed", async () => {
    const onChange = vi.fn();
    render(
      <Textarea aria-label="Welcome text" value="hello" onChange={onChange} />,
    );

    const field = screen.getByLabelText("Welcome text");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveValue("hello");

    await userEvent.type(field, "!");
    expect(onChange).toHaveBeenCalled();
  });

  // Not decoration: `data-slot` is shadcn's slot marker, the attribute a
  // stylesheet or a test reaches this field by without depending on the
  // utility classes it happens to carry.
  it("carries shadcn's slot marker", () => {
    render(<Textarea aria-label="Welcome text" readOnly value="" />);

    expect(screen.getByLabelText("Welcome text")).toHaveAttribute(
      "data-slot",
      "textarea",
    );
  });

  it("lets a caller's class win over its own", () => {
    render(
      <Textarea aria-label="Welcome text" readOnly value="" className="p-0" />,
    );

    const field = screen.getByLabelText("Welcome text");
    expect(field).toHaveClass("p-0");
    // `cn` resolved the conflict rather than emitting both.
    expect(field).not.toHaveClass("px-4");
  });

  it("passes the rest of its props through to the element", () => {
    render(<Textarea aria-label="Welcome text" readOnly value="" disabled />);

    expect(screen.getByLabelText("Welcome text")).toBeDisabled();
  });
});
