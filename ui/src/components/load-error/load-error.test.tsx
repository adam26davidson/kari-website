import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoadError } from "./load-error";

describe("LoadError", () => {
  it("shows the failure message", () => {
    render(<LoadError message="Could not load haiku" onRetry={() => {}} />);
    expect(screen.getByText("Could not load haiku")).toBeInTheDocument();
  });

  it("fires onRetry when Retry is clicked", async () => {
    const onRetry = vi.fn();
    render(<LoadError message="failed" onRetry={onRetry} />);

    await userEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
