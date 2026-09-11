import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

describe("Input", () => {
  it("is a controlled input that reports what was typed", async () => {
    const onChange = vi.fn();
    render(<Input aria-label="Publisher" value="kari" onChange={onChange} />);

    const field = screen.getByLabelText("Publisher");
    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveValue("kari");

    await userEvent.type(field, "!");
    expect(onChange).toHaveBeenCalled();
  });

  // Not decoration: admin.css's unlayered `input` rules opt out through
  // `:not([data-slot="input"])`, so without this attribute the field
  // renders as the legacy grey 400px box whatever utilities it carries.
  it("carries the data-slot the legacy stylesheet keys its opt-out on", () => {
    render(<Input aria-label="Publisher" readOnly value="" />);

    expect(screen.getByLabelText("Publisher")).toHaveAttribute(
      "data-slot",
      "input",
    );
  });

  it("lets a caller's class win over its own", () => {
    render(<Input aria-label="Publisher" readOnly value="" className="px-0" />);

    const field = screen.getByLabelText("Publisher");
    expect(field).toHaveClass("px-0");
    // `cn` resolved the conflict rather than emitting both.
    expect(field).not.toHaveClass("px-4");
  });

  // The list page's search box asks for `pl-10` to clear the magnifying
  // glass drawn inside the field, and needs the recipe's own `px-4` to
  // survive on the right-hand side. `cn`'s merge keeps both, which is the
  // property that request depends on.
  it("keeps its own padding on the side a caller did not override", () => {
    render(
      <Input aria-label="Search haiku" readOnly value="" className="pl-10" />,
    );

    expect(screen.getByLabelText("Search haiku")).toHaveClass("px-4", "pl-10");
  });

  it("passes the rest of its props through to the element", () => {
    render(<Input aria-label="Search haiku" type="search" readOnly value="" />);

    // `type` reaches the element, so a caller can ask for the search box
    // the list page needs rather than getting a text field.
    expect(
      screen.getByRole("searchbox", { name: "Search haiku" }),
    ).toBeTruthy();
  });
});
