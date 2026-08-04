import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminButton } from "./admin-button";

describe("AdminButton", () => {
  it("renders its children", () => {
    render(<AdminButton>Save</AdminButton>);
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("fires onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<AdminButton onClick={onClick}>Save</AdminButton>);

    await userEvent.click(screen.getByText("Save"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("links to a form control via htmlFor for file-picker labels", () => {
    render(<AdminButton htmlFor="file-input">Pick</AdminButton>);
    expect(screen.getByText("Pick")).toHaveAttribute("for", "file-input");
  });
});
