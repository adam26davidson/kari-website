import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageTitle } from "./page-title";

describe("PageTitle", () => {
  it("renders its words as the page's level-2 heading", () => {
    render(<PageTitle>Good morning, Kari</PageTitle>);

    expect(
      screen.getByRole("heading", { level: 2, name: "Good morning, Kari" }),
    ).toBeInTheDocument();
  });

  it("keeps the brush swash out of the accessibility tree", () => {
    const { container } = render(<PageTitle>Good morning, Kari</PageTitle>);

    const swash = container.querySelector("svg");
    expect(swash).toHaveAttribute("aria-hidden", "true");
    // The heading is named by its words alone — nothing about a brush
    // stroke reaches the accessible name.
    expect(screen.getByRole("heading", { level: 2 })).toHaveAccessibleName(
      "Good morning, Kari",
    );
  });

  it("takes a caller's classes alongside its own", () => {
    render(<PageTitle className="mb-8">Haiku</PageTitle>);

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveClass("mb-8");
    // Its own colour is still stated: a heading that inherits is a heading
    // that disappears on this paper (#457).
    expect(heading).toHaveClass("text-foreground");
  });
});
