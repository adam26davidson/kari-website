import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TitleLink } from "./title-link";

describe("TitleLink", () => {
  it("renders an internal href as a router link with the title-link class", () => {
    render(
      <MemoryRouter>
        <TitleLink href="/somewhere">Go</TitleLink>
      </MemoryRouter>,
    );
    const link = screen.getByText("Go");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/somewhere");
    expect(link).toHaveClass("title-link");
  });

  it("navigates client-side when an internal link is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<TitleLink href="/blog/123">My Post</TitleLink>}
          />
          <Route path="/blog/:id" element={<div>Post page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByText("My Post"));
    expect(screen.getByText("Post page")).toBeInTheDocument();
  });

  it("renders an external href as an anchor opening in a new tab", () => {
    render(<TitleLink href="https://example.com">External</TitleLink>);
    const link = screen.getByRole("link", { name: "External" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("title-link");
  });

  it("renders a button and fires onClick when provided", async () => {
    const onClick = vi.fn();
    render(<TitleLink onClick={onClick}>Click me</TitleLink>);

    const button = screen.getByRole("button", { name: "Click me" });
    expect(button).toHaveClass("title-link");
    expect(button).toHaveAttribute("type", "button");

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("activates the onClick variant with the Enter key", async () => {
    const onClick = vi.fn();
    render(<TitleLink onClick={onClick}>Keyboard me</TitleLink>);

    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Keyboard me" })).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("activates the onClick variant with the Space key", async () => {
    const onClick = vi.fn();
    render(<TitleLink onClick={onClick}>Keyboard me</TitleLink>);

    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Keyboard me" })).toHaveFocus();

    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("prefers the onClick button branch over an href when both are given", () => {
    render(
      <TitleLink href="/ignored" onClick={() => {}}>
        Both
      </TitleLink>,
    );
    const button = screen.getByRole("button", { name: "Both" });
    expect(button).not.toHaveAttribute("href");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
