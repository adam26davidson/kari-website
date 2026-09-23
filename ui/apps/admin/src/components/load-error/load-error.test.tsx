import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoadError } from "./load-error";

describe("LoadError", () => {
  it("shows the failure message and what to do next", () => {
    render(<LoadError message="Could not load haiku" onRetry={() => {}} />);

    expect(screen.getByText("Could not load haiku")).toBeInTheDocument();
    expect(screen.getByText(/try again in a moment/)).toBeInTheDocument();
  });

  it("fires onRetry when Retry is clicked", async () => {
    const onRetry = vi.fn();
    render(<LoadError message="failed" onRetry={onRetry} />);

    // By role, not by text: the e2e journey clicks a real <button>.
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("is announced as an alert and carries the e2e hook", () => {
    render(<LoadError message="failed" onRetry={() => {}} />);

    const alert = screen.getByRole("alert");
    // The hook e2e/helpers.ts and admin-whats-on-test.spec.ts locate.
    expect(alert).toHaveClass("admin-load-error");
    // The card itself, not a wrapper around one.
    expect(alert).toHaveAttribute("data-slot", "card");
  });
});
