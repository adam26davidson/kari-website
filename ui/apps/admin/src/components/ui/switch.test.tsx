import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";

describe("Switch", () => {
  it("renders as a switch that reports whether it is on", () => {
    render(<Switch aria-label="Published" checked onCheckedChange={vi.fn()} />);

    const control = screen.getByRole("switch", { name: "Published" });
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("reports a flip through onCheckedChange", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        aria-label="Published"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await userEvent.click(screen.getByRole("switch", { name: "Published" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("is reachable by clicking a label pointing at it", async () => {
    const onCheckedChange = vi.fn();
    render(
      <>
        <Switch
          id="published"
          checked={false}
          onCheckedChange={onCheckedChange}
        />
        <label htmlFor="published">Published</label>
      </>,
    );

    // The word, not the control: a label that points at nothing is how the
    // checkbox this replaces shipped un-clickable (#457).
    await userEvent.click(screen.getByText("Published"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("lets a caller's class win over its own", () => {
    render(<Switch aria-label="Published" checked={false} className="w-20" />);

    const control = screen.getByRole("switch", { name: "Published" });
    expect(control).toHaveClass("w-20");
    // `cn` resolved the conflict rather than emitting both.
    expect(control).not.toHaveClass("w-11");
  });

  it("cannot be flipped while disabled", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        aria-label="Published"
        disabled
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    const control = screen.getByRole("switch", { name: "Published" });
    expect(control).toBeDisabled();
    await userEvent.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
