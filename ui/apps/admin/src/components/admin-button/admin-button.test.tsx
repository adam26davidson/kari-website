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

  // The look is the shadcn recipe since #592, but these classes still are
  // not decoration: admin-item-list.css reaches a row's buttons through
  // `.admin-data-list-item-controls .admin-button` and its Delete through
  // `.danger-secondary`, and the e2e journeys click Save, Log In and the
  // confirmation's Yes/No by `.admin-button`. They go when those do (#240).
  it("is primary by default, carrying no variant class", () => {
    render(<AdminButton>Save</AdminButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("admin-button");
    expect(button.className).not.toMatch(/secondary|danger/);
  });

  it.each(["secondary", "danger", "danger-secondary"] as const)(
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

  // Each weight has to LOOK different, or the four names are a comment.
  // Asserted as "the fill/ring classes differ", not as specific utilities:
  // which Tailwind classes say "green fill" is the recipe's business.
  it("gives each weight a look of its own", () => {
    const classNames = (
      ["primary", "secondary", "danger", "danger-secondary"] as const
    ).map((variant) => {
      const { unmount } = render(
        <AdminButton variant={variant}>Do it</AdminButton>,
      );
      const className = screen.getByRole("button", { name: "Do it" }).className;
      unmount();
      return className;
    });
    expect(new Set(classNames).size).toBe(4);
  });

  // The label branch is a <label>, not a <button>, so it cannot inherit the
  // button's styling by element — it has to be given the same recipe or the
  // photo picker's "Choose a photo" is an unstyled word on the card.
  it("styles the label branch like the button branch", () => {
    const { unmount } = render(<AdminButton>Pick</AdminButton>);
    const asButton = screen.getByRole("button", { name: "Pick" }).className;
    unmount();

    render(<AdminButton htmlFor="file-input">Pick</AdminButton>);
    const asLabel = screen.getByRole("button", { name: "Pick" }).className;

    expect(asLabel.split(" ").sort()).toEqual(asButton.split(" ").sort());
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

  // Only the two keys a real button responds to. Forwarding anything else
  // would make Tab, the arrow keys and every typed character open a file
  // chooser from a focused label.
  it("ignores keys that are not Enter or Space", async () => {
    const onFileClick = vi.fn();
    render(
      <>
        <input id="file-input" type="file" hidden onClick={onFileClick} />
        <AdminButton htmlFor="file-input">Pick</AdminButton>
      </>,
    );

    screen.getByRole("button", { name: "Pick" }).focus();
    await userEvent.keyboard("{ArrowDown}a");

    expect(onFileClick).not.toHaveBeenCalled();
  });
});
