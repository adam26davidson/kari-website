import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./card";

describe("Card", () => {
  it("renders its children", () => {
    render(
      <Card>
        <span>hello world</span>
      </Card>,
    );
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("wraps children in an element with the card class", () => {
    const { container } = render(<Card>content</Card>);
    expect(container.querySelector(".card")).toBeInTheDocument();
  });
});
