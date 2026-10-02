import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingOverlay } from "./loading-overlay";

describe("LoadingOverlay", () => {
  // `.admin-loading` on the OUTERMOST element is what e2e/helpers.ts
  // waitForIdle waits to be hidden.
  it("carries the class the e2e suite waits on, on its root", () => {
    const { container } = render(<LoadingOverlay message="Saving..." />);
    expect(container.firstElementChild).toHaveClass("admin-loading");
  });

  it("announces the message as a status", () => {
    render(<LoadingOverlay message="Saving..." />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Saving\.\.\.$/);
  });

  it("shows a turning ring and no bar for a wait of unknown length", () => {
    const { container } = render(<LoadingOverlay message="Saving..." />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a filling bar and the percentage, instead of the ring, when the progress is known", () => {
    const { container } = render(
      <LoadingOverlay message="Sending..." progress={0.432} />,
    );
    const bar = screen.getByRole("progressbar", { name: "Upload progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "43");
    expect(bar.firstElementChild).toHaveStyle({ width: "43%" });
    expect(screen.getByText("43%")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
    // The percentage is the bar's to announce; repeating it in the live
    // region would re-announce on every tick.
    expect(screen.getByRole("status")).toHaveTextContent(/^Sending\.\.\.$/);
  });

  it("keeps an out-of-range fraction on the bar", () => {
    const { rerender } = render(
      <LoadingOverlay message="Sending..." progress={1.2} />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    rerender(<LoadingOverlay message="Sending..." progress={-0.1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});
