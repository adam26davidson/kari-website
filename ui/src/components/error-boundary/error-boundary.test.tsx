import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./error-boundary";

function Boom(): never {
  throw new Error("boom");
}

beforeEach(() => {
  // React and componentDidCatch both log the thrown error; keep output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong displaying this page."),
    ).not.toBeInTheDocument();
  });

  it("catches a throwing child and renders the fallback", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText("Something went wrong displaying this page."),
    ).toBeInTheDocument();
  });

  it("offers a reload button in the fallback", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole("button", { name: "Reload" }),
    ).toBeInTheDocument();
  });

  it("logs the render error for diagnostics", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(
      "Render error:",
      expect.any(Error),
      expect.anything(),
    );
  });
});
