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

  it("renders an external href as a plain anchor", () => {
    render(<TitleLink href="https://example.com">External</TitleLink>);
    const link = screen.getByText("External");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveClass("title-link");
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
