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

  // Not decoration: admin.css's unlayered `textarea` rules opt out through
  // `:not([data-slot="textarea"])`, so without this attribute the field
  // renders as the legacy grey 400px box whatever utilities it carries.
  it("carries the data-slot the legacy stylesheet keys its opt-out on", () => {
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
