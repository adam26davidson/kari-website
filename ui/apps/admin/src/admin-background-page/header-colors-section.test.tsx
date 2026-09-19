import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SiteSettings } from "@kari/shared/models";
import { HEADER_COLOR_DEFAULTS } from "@kari/shared/utils/color";
import { HeaderColorsSection } from "./header-colors-section";

/** Renders the section over a settings object, returning the change spy. */
function renderSection(settings: Partial<SiteSettings> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <HeaderColorsSection
      settings={{ backgroundPhoto: "", ...settings }}
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

const swatch = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;

/**
 * The see-through control. A Radix slider rather than a native range since
 * #816, so it is reached by role: the thing that carries `role="slider"`
 * and the value is a thumb, not an `<input>` a label could point at.
 */
const seeThroughSlider = () =>
  screen.getByRole("slider", { name: "See-through" });

/** Drives the slider the only way jsdom can: from the keyboard. */
const pressOnSlider = (key: string) =>
  fireEvent.keyDown(seeThroughSlider(), { key });

const bar = () =>
  document.querySelector(".header-colors-preview-bar") as HTMLElement;

describe("HeaderColorsSection defaults", () => {
  it("shows the site's built-in colours when nothing is set", () => {
    renderSection();

    expect(swatch("Bar").value).toBe(HEADER_COLOR_DEFAULTS.background);
    expect(swatch("Site title").value).toBe(HEADER_COLOR_DEFAULTS.title);
    expect(swatch("Page links").value).toBe(HEADER_COLOR_DEFAULTS.nav);
    expect(
      screen.getByText("These are the site's built-in colours."),
    ).toBeInTheDocument();
  });

  it("shows the built-in bar opacity as how see-through it is", () => {
    // The default tint is 86% opaque, which is 14% see-through.
    renderSection();

    expect(seeThroughSlider()).toHaveAttribute("aria-valuenow", "14");
    expect(screen.getByText("14%")).toBeInTheDocument();
  });

  it("offers no reset while every colour is already the built-in one", () => {
    renderSection();

    expect(screen.queryByText("Use default")).not.toBeInTheDocument();
  });

  it("shows the chosen colours rather than the defaults once set", () => {
    renderSection({
      headerBackgroundColor: "#10203080",
      headerTitleColor: "#ffee00",
      headerNavColor: "#00ff00",
    });

    expect(swatch("Bar").value).toBe("#102030");
    expect(seeThroughSlider()).toHaveAttribute("aria-valuenow", "50");
    expect(swatch("Site title").value).toBe("#ffee00");
    expect(swatch("Page links").value).toBe("#00ff00");
    expect(
      screen.queryByText("These are the site's built-in colours."),
    ).not.toBeInTheDocument();
  });

  it("falls back to the built-in colours for an unreadable stored value", () => {
    // Only reachable by hand-editing site-settings.json, but the page must
    // show what the site will actually paint, which is the default.
    renderSection({ headerBackgroundColor: "rebeccapurple" });

    expect(swatch("Bar").value).toBe(HEADER_COLOR_DEFAULTS.background);
  });
});

describe("HeaderColorsSection preview", () => {
  it("renders the title and the page links in the chosen colours", () => {
    renderSection({
      headerBackgroundColor: "#102030ff",
      headerTitleColor: "#ffee00",
      headerNavColor: "#00ff00",
    });

    expect(bar()).toHaveStyle({ backgroundColor: "#102030ff" });
    expect(screen.getByText("Kari Davidson")).toHaveStyle({
      color: "#ffee00",
    });
    for (const link of ["Home", "Haiku", "Photography"]) {
      expect(screen.getByText(link)).toHaveStyle({ color: "#00ff00" });
    }
  });
});

describe("HeaderColorsSection editing", () => {
  it("keeps the bar's opacity when only its colour is picked", () => {
    const { onChange } = renderSection({ headerBackgroundColor: "#10203080" });

    fireEvent.change(swatch("Bar"), { target: { value: "#aabbcc" } });

    expect(onChange).toHaveBeenCalledWith({
      headerBackgroundColor: "#aabbcc80",
    });
  });

  it("keeps the bar's colour when only the slider is moved", () => {
    const { onChange } = renderSection({ headerBackgroundColor: "#10203080" });

    // Home is "not see-through at all", i.e. fully opaque.
    pressOnSlider("Home");

    expect(onChange).toHaveBeenCalledWith({
      headerBackgroundColor: "#102030ff",
    });
  });

  it("composes the slider onto the built-in bar colour", () => {
    const { onChange } = renderSection();

    // End is "all the way see-through", i.e. fully transparent.
    pressOnSlider("End");

    expect(onChange).toHaveBeenCalledWith({
      headerBackgroundColor: `${HEADER_COLOR_DEFAULTS.background}00`,
    });
  });

  it("nudges the bar one step more see-through at a time", () => {
    // The arrows are the whole keyboard story for a slider; without them
    // this control is only reachable by dragging it.
    const { onChange } = renderSection({ headerBackgroundColor: "#10203080" });

    pressOnSlider("ArrowRight");

    // 50% see-through becomes 51%, i.e. alpha 0.49 → 0x7d.
    expect(onChange).toHaveBeenCalledWith({
      headerBackgroundColor: "#1020307d",
    });
  });

  it.each([
    ["Site title", "headerTitleColor"],
    ["Page links", "headerNavColor"],
  ])("reports a %s choice on its own field", (label, field) => {
    const { onChange } = renderSection();

    fireEvent.change(swatch(label), { target: { value: "#123456" } });

    expect(onChange).toHaveBeenCalledWith({ [field]: "#123456" });
  });
});

describe("HeaderColorsSection resets", () => {
  it("clears only the setting whose reset was pressed", () => {
    const { onChange } = renderSection({
      headerTitleColor: "#ffee00",
      headerNavColor: "#00ff00",
    });

    // One reset per set colour; the bar is still the built-in one.
    const resets = screen.getAllByText("Use default");
    expect(resets).toHaveLength(2);

    fireEvent.click(resets[0]);
    expect(onChange).toHaveBeenCalledWith({ headerTitleColor: "" });
    expect(onChange).toHaveBeenCalledOnce();

    fireEvent.click(resets[1]);
    expect(onChange).toHaveBeenCalledWith({ headerNavColor: "" });
  });

  it("clears the bar's colour and opacity together", () => {
    const { onChange } = renderSection({ headerBackgroundColor: "#10203080" });

    fireEvent.click(screen.getByText("Use default"));

    expect(onChange).toHaveBeenCalledWith({ headerBackgroundColor: "" });
  });
});

describe("HeaderColorsSection contrast warning", () => {
  const TITLE_OK = "The site title reads clearly on this bar.";
  const LINKS_OK = "The page links read clearly on this bar.";
  const titleWarning = () =>
    screen.queryByText(/^The site title may be hard to read/);
  const linksWarning = () =>
    screen.queryByText(/^The page links may be hard to read/);

  it("says both foregrounds read clearly at the built-in colours", () => {
    renderSection();

    expect(screen.getByText(TITLE_OK)).toBeInTheDocument();
    expect(screen.getByText(LINKS_OK)).toBeInTheDocument();
    expect(titleWarning()).not.toBeInTheDocument();
    expect(linksWarning()).not.toBeInTheDocument();
  });

  it("warns about both when a pale bar is chosen behind white text", () => {
    renderSection({ headerBackgroundColor: "#f5f5f5ff" });

    expect(titleWarning()).toBeInTheDocument();
    expect(linksWarning()).toBeInTheDocument();
    // Advice, not blame or a blocked save.
    expect(titleWarning()?.textContent).toContain("Try a bar colour");
  });

  it("warns about the two pairings independently", () => {
    renderSection({
      headerBackgroundColor: "#f5f5f5ff",
      headerTitleColor: "#111111",
    });

    expect(titleWarning()).not.toBeInTheDocument();
    expect(screen.getByText(TITLE_OK)).toBeInTheDocument();
    expect(linksWarning()).toBeInTheDocument();
  });

  // The ratio is how the note is DECIDED, not something the reader needs:
  // "contrast 9.1 to 1" is the code's vocabulary, and the sentence beside it
  // already says the only thing she can act on (design brief §3).
  it("never shows the measured ratio, only the plain sentence", () => {
    renderSection({ headerBackgroundColor: "#f5f5f5ff" });

    expect(screen.queryByText(/contrast/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\.\d to 1/)).not.toBeInTheDocument();
    expect(titleWarning()).toBeInTheDocument();
  });
});
