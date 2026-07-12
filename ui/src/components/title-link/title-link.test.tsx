import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleLink } from "./title-link";

describe("TitleLink", () => {
  it("renders an anchor with the given href when no onClick is provided", () => {
    render(<TitleLink href="/somewhere">Go</TitleLink>);
    const link = screen.getByText("Go");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/somewhere");
  });

  it("renders a clickable div and fires onClick when provided", async () => {
    const onClick = vi.fn();
    render(<TitleLink onClick={onClick}>Click me</TitleLink>);

    const el = screen.getByText("Click me");
    expect(el.tagName).toBe("DIV");

    await userEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("prefers the onClick div branch over an href when both are given", () => {
    render(
      <TitleLink href="/ignored" onClick={() => {}}>
        Both
      </TitleLink>,
    );
    const el = screen.getByText("Both");
    expect(el.tagName).toBe("DIV");
    expect(el).not.toHaveAttribute("href");
  });
});
