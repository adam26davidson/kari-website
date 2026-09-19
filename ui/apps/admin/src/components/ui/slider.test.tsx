import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Slider } from "./slider";

/** Renders a one-thumb slider the way every caller in the admin does. */
function renderSlider(value: number, props: Record<string, unknown> = {}) {
  const onValueChange = vi.fn();
  render(
    <Slider
      aria-label="See-through"
      value={[value]}
      onValueChange={onValueChange}
      min={0}
      max={100}
      {...props}
    />,
  );
  return { onValueChange, thumb: screen.getByRole("slider") };
}

describe("Slider", () => {
  it("announces the value it is showing", () => {
    // The role sits on the THUMB, not the root — a test or a label that
    // reaches for the root finds nothing that speaks a value.
    const { thumb } = renderSlider(30);

    expect(thumb).toHaveAttribute("aria-valuenow", "30");
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "100");
  });

  it("is named by the words beside it", () => {
    renderSlider(30);

    expect(
      screen.getByRole("slider", { name: "See-through" }),
    ).toBeInTheDocument();
  });

  it("takes the name from a visible label that points at it", () => {
    // How the Appearance page wires it: a real <label> with an id, so the
    // words on screen and the name a screen reader says are the same ones.
    const onValueChange = vi.fn();
    render(
      <>
        <span id="see-through-label">See-through</span>
        <Slider
          aria-labelledby="see-through-label"
          value={[30]}
          onValueChange={onValueChange}
        />
      </>,
    );

    expect(
      screen.getByRole("slider", { name: "See-through" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["ArrowRight", 31],
    ["ArrowUp", 31],
    ["ArrowLeft", 29],
    ["ArrowDown", 29],
  ])("steps the value with %s", (key, expected) => {
    const { onValueChange, thumb } = renderSlider(30);

    fireEvent.keyDown(thumb, { key });

    expect(onValueChange).toHaveBeenCalledWith([expected]);
  });

  it.each([
    ["Home", 0],
    ["End", 100],
  ])("jumps to the end of the range with %s", (key, expected) => {
    const { onValueChange, thumb } = renderSlider(30);

    fireEvent.keyDown(thumb, { key });

    expect(onValueChange).toHaveBeenCalledWith([expected]);
  });

  it("moves by the step it is given rather than by one", () => {
    const { onValueChange, thumb } = renderSlider(30, { step: 5 });

    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    expect(onValueChange).toHaveBeenCalledWith([35]);
  });

  it("goes no further than the range allows", () => {
    const { onValueChange, thumb } = renderSlider(100);

    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
