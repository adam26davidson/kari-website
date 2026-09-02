import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SiteSettings } from "@kari/shared/models";
import {
  DEFAULT_FONT_PAIRING,
  FONT_PAIRINGS,
  fontStylesheetUrl,
} from "@kari/shared/utils/fonts";
import { FontPairingSection } from "./font-pairing-section";

/** Renders the section over a settings object, returning the change spy. */
function renderSection(settings: Partial<SiteSettings> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <FontPairingSection
      settings={{ backgroundPhoto: "", ...settings }}
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

const option = (label: string) =>
  screen.getByRole("radio", { name: new RegExp(label) }) as HTMLInputElement;

const CUSTOM = FONT_PAIRINGS[1];

afterEach(() => {
  for (const link of document.head.querySelectorAll("link[data-font-pairing]")) {
    link.remove();
  }
});

describe("FontPairingSection", () => {
  it("offers every pairing by name, with a line about how it feels", () => {
    renderSection();

    expect(screen.getAllByRole("radio")).toHaveLength(FONT_PAIRINGS.length);
    for (const pairing of FONT_PAIRINGS) {
      expect(option(pairing.label)).toBeInTheDocument();
      expect(screen.getByText(pairing.description)).toBeInTheDocument();
    }
  });

  it.each([
    ["a settings object written before the field existed", undefined],
    ["an explicitly empty choice", ""],
    ["a pairing we no longer ship", "helvetica-forever"],
  ])("shows the site's usual fonts as chosen for %s", (_name, fontPairing) => {
    // All three render as the built-in pairing on the public site, so the
    // picker has to agree — showing nothing selected would invite a save
    // that changes nothing and reports that it did.
    renderSection(fontPairing === undefined ? {} : { fontPairing });

    expect(option(DEFAULT_FONT_PAIRING.label).checked).toBe(true);
  });

  it("shows the stored pairing as chosen", () => {
    renderSection({ fontPairing: CUSTOM.id });

    expect(option(CUSTOM.label).checked).toBe(true);
    expect(option(DEFAULT_FONT_PAIRING.label).checked).toBe(false);
  });

  it("reports a new choice upward rather than saving it", () => {
    const { onChange } = renderSection();

    fireEvent.click(option(CUSTOM.label));

    expect(onChange).toHaveBeenCalledWith({ fontPairing: CUSTOM.id });
  });

  it("puts the fonts back by choosing the built-in pairing", () => {
    // No separate reset button: the way back is the same gesture as the way
    // out, and it stores "" — the value everything else treats as default.
    const { onChange } = renderSection({ fontPairing: CUSTOM.id });

    fireEvent.click(option(DEFAULT_FONT_PAIRING.label));

    expect(onChange).toHaveBeenCalledWith({ fontPairing: "" });
  });

  it("renders each sample in the typefaces it is offering", () => {
    // She chooses by look, so the sample has to BE the pairing, not a
    // description of it. jsdom loads no fonts, so this checks the styles the
    // browser would render from; the screenshots check the result.
    renderSection();

    for (const pairing of FONT_PAIRINGS) {
      const sample = document.querySelector(
        `[data-sample="${pairing.id}"]`,
      ) as HTMLElement;
      const caption = document.querySelector(
        `[data-caption="${pairing.id}"]`,
      ) as HTMLElement;
      expect(sample.style.fontFamily).toBe(pairing.bodyFamily);
      expect(sample.style.fontWeight).toBe(String(pairing.displayWeight));
      expect(caption.style.fontFamily).toBe(pairing.uiFamily);
    }
  });

  it("loads every pairing's stylesheet so the samples are not all alike", () => {
    renderSection();

    const links = Array.from(
      document.head.querySelectorAll("link[data-font-pairing]"),
    );
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      FONT_PAIRINGS.slice(1).map((pairing) => fontStylesheetUrl(pairing)),
    );
  });
});
