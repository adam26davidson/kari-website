import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingLine } from "./loading-line";

describe("LoadingLine", () => {
  it("is a quiet status line", () => {
    render(<LoadingLine />);

    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("Loading...");
    // Not the shared `.loading` card, whose unlayered rule would win.
    expect(line).not.toHaveClass("loading");
  });
});
