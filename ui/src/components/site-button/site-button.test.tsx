import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteButton } from "./site-button";

describe("SiteButton", () => {
  it("renders a real button with its children as accessible name", () => {
    render(<SiteButton>Retry</SiteButton>);
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button.tagName).toBe("BUTTON");
  });

  it("fires onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<SiteButton onClick={onClick}>Retry</SiteButton>);

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("fires onClick from the keyboard", async () => {
    const onClick = vi.fn();
    render(<SiteButton onClick={onClick}>Retry</SiteButton>);

    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
