import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { ErrorBoundary, RouteErrorBoundary } from "./error-boundary";

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

  it("clears the error and renders children again when resetKey changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/broken">
        <Boom />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText("Something went wrong displaying this page."),
    ).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/healthy">
        <p>back on track</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("back on track")).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong displaying this page."),
    ).not.toBeInTheDocument();
  });

  it("keeps showing the fallback while resetKey is unchanged", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/broken">
        <Boom />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary resetKey="/broken">
        <p>never shown</p>
      </ErrorBoundary>,
    );
    expect(
      screen.getByText("Something went wrong displaying this page."),
    ).toBeInTheDocument();
    expect(screen.queryByText("never shown")).not.toBeInTheDocument();
  });
});

describe("RouteErrorBoundary", () => {
  it("recovers when the visitor navigates to a different route", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/broken"]}>
        <Link to="/haiku">Haiku</Link>
        <RouteErrorBoundary>
          <Routes>
            <Route path="/broken" element={<Boom />} />
            <Route path="/haiku" element={<p>haiku page</p>} />
          </Routes>
        </RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Something went wrong displaying this page."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Haiku" }));

    expect(screen.getByText("haiku page")).toBeInTheDocument();
    expect(
      screen.queryByText("Something went wrong displaying this page."),
    ).not.toBeInTheDocument();
  });
});
