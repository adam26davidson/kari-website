import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminButton } from "./admin-button";

describe("AdminButton", () => {
  it("renders a real button with its children as accessible name", () => {
    render(<AdminButton>Save</AdminButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.tagName).toBe("BUTTON");
  });

  it("fires onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<AdminButton onClick={onClick}>Save</AdminButton>);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("fires onClick from the keyboard", async () => {
    const onClick = vi.fn();
    render(<AdminButton onClick={onClick}>Save</AdminButton>);

    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is primary by default, carrying no variant class", () => {
    render(<AdminButton>Save</AdminButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("admin-button");
    expect(button.className).toBe("admin-button");
  });

  it.each(["secondary", "danger"] as const)(
    "marks a %s button with its variant class",
    (variant) => {
      render(<AdminButton variant={variant}>Close</AdminButton>);
      const button = screen.getByRole("button", { name: "Close" });
      expect(button).toHaveClass("admin-button");
      expect(button).toHaveClass(variant);
    },
  );

  it("carries the variant class on the htmlFor label branch too", () => {
    render(
      <AdminButton htmlFor="file-input" variant="secondary">
        Pick
      </AdminButton>,
    );
    expect(screen.getByRole("button", { name: "Pick" })).toHaveClass(
      "secondary",
    );
  });

  it("renders a disabled button that does not fire onClick", async () => {
    const onClick = vi.fn();
    render(
      <AdminButton onClick={onClick} disabled>
        Save
      </AdminButton>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("links to a form control via htmlFor for file-picker labels", () => {
    render(<AdminButton htmlFor="file-input">Pick</AdminButton>);
    const button = screen.getByRole("button", { name: "Pick" });
    expect(button.tagName).toBe("LABEL");
    expect(button).toHaveAttribute("for", "file-input");
  });

  it("activates the linked control from the keyboard", async () => {
    const onFileClick = vi.fn();
    render(
      <>
        <input id="file-input" type="file" hidden onClick={onFileClick} />
        <AdminButton htmlFor="file-input">Pick</AdminButton>
      </>,
    );

    const button = screen.getByRole("button", { name: "Pick" });
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onFileClick).toHaveBeenCalledOnce();

    await userEvent.keyboard(" ");
    expect(onFileClick).toHaveBeenCalledTimes(2);
  });
});
