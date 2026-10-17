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

  it("keeps the swash off the viewport edge at phone width", () => {
    const { container } = render(<PageTitle>Haiga</PageTitle>);

    const swash = container.querySelector("svg");
    const classes = swash?.getAttribute("class")?.split(/\s+/) ?? [];
    // The phone content gutter is 18px (admin.css; pinned at no less by
    // test/design/phone-gutter.test.ts). The stroke bleeds 8px of it, so
    // its taper starts 10px in — where the *Mobile.png boards draw it.
    // Any deeper bleed lands the taper within a few pixels of the screen
    // edge and it reads as sliding off the page rather than as a flourish
    // (#839). The full bleed is for md and up, with its 32px gutter.
    const phoneLeft = classes.filter((c) => /^-?left-/.test(c));
    expect(phoneLeft).toHaveLength(1);
    const bleed = phoneLeft[0].startsWith("-")
      ? Number(phoneLeft[0].replace("-left-", "")) * 4
      : 0;
    expect(bleed).toBeLessThanOrEqual(8);
    expect(classes).toContain("md:-left-5");
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
