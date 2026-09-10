import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./card";

describe("Card", () => {
  it("renders what it is given inside a card element", () => {
    render(
      <Card>
        <p>Your welcome text</p>
      </Card>,
    );

    const content = screen.getByText("Your welcome text");
    expect(content.closest('[data-slot="card"]')).toBeInTheDocument();
  });

  it("lets a caller's class win over its own", () => {
    render(<Card className="rounded-none">panel</Card>);

    const card = screen.getByText("panel");
    expect(card).toHaveClass("rounded-none");
    // `cn` resolved the radius conflict rather than emitting both.
    expect(card).not.toHaveClass("rounded-xl");
    // Everything it did not conflict with is still there.
    expect(card).toHaveClass("bg-card");
  });
});
