import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SiteSettings } from "@kari/shared/models";
import {
  DEFAULT_FONT_PAIRING,
  FONT_PAIRINGS,
  loadPairingFonts,
} from "@kari/shared/utils/fonts";
import { FontPairingSection } from "./font-pairing-section";

// The real thing reaches the network through a <link> and the Font Loading
// API, neither of which jsdom has. What this section does with the ANSWER —
// show the lettering, say it is coming, or admit it did not arrive — is the
// behavior under test, so the answer is what the tests control.
vi.mock("@kari/shared/utils/fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kari/shared/utils/fonts")>()),
  loadPairingFonts: vi.fn(),
}));

/** The pairings that have lettering to fetch (every one but the built-in). */
const FETCHED = FONT_PAIRINGS.slice(1);

const CUSTOM = FETCHED[0];

/** Answers every pairing's load the same way. */
const everyPairing = (answer: () => Promise<void>) =>
  vi.mocked(loadPairingFonts).mockImplementation(answer);

/** A load that never settles, so the samples stay pending. */
const stillLoading = () => everyPairing(() => new Promise<void>(() => {}));

beforeEach(() => {
  everyPairing(() => Promise.resolve());
});

/**
 * Renders the section over a settings object, returning the change spy.
 *
 * Async because the samples start out pending and become ready when their
 * faces answer: settling those promises is part of getting to the state a
 * test is about.
 */
async function renderSection(settings: Partial<SiteSettings> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <FontPairingSection
      settings={{ backgroundPhoto: "", ...settings }}
      onChange={onChange}
    />,
  );
  await act(async () => {});
  return { ...utils, onChange };
}

const option = (label: string) =>
  screen.getByRole("radio", { name: new RegExp(label) }) as HTMLInputElement;

const sampleOf = (pairing: { id: string }) =>
  document.querySelector(`[data-sample="${pairing.id}"]`);

const loadingLines = () => screen.queryAllByText("Loading this lettering…");

describe("FontPairingSection", () => {
  it("offers every pairing by name, with a line about how it feels", async () => {
    await renderSection();

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
  ])(
    "shows the site's usual fonts as chosen for %s",
    async (_name, fontPairing) => {
      // All three render as the built-in pairing on the public site, so the
      // picker has to agree — showing nothing selected would invite a save
      // that changes nothing and reports that it did.
      await renderSection(
        fontPairing === undefined ? {} : { fontPairing },
      );

      expect(option(DEFAULT_FONT_PAIRING.label).checked).toBe(true);
    },
  );

  it("shows the stored pairing as chosen", async () => {
    await renderSection({ fontPairing: CUSTOM.id });

    expect(option(CUSTOM.label).checked).toBe(true);
    expect(option(DEFAULT_FONT_PAIRING.label).checked).toBe(false);
  });

  it("reports a new choice upward rather than saving it", async () => {
    const { onChange } = await renderSection();

    fireEvent.click(option(CUSTOM.label));

    expect(onChange).toHaveBeenCalledWith({ fontPairing: CUSTOM.id });
  });

  it("puts the fonts back by choosing the built-in pairing", async () => {
    // No separate reset button: the way back is the same gesture as the way
    // out, and it stores "" — the value everything else treats as default.
    const { onChange } = await renderSection({ fontPairing: CUSTOM.id });

    fireEvent.click(option(DEFAULT_FONT_PAIRING.label));

    expect(onChange).toHaveBeenCalledWith({ fontPairing: "" });
  });

  it("renders each sample in the typefaces it is offering", async () => {
    // She chooses by look, so the sample has to BE the pairing, not a
    // description of it. jsdom loads no fonts, so this checks the styles the
    // browser would render from; the screenshots check the result.
    await renderSection();

    for (const pairing of FONT_PAIRINGS) {
      const sample = sampleOf(pairing) as HTMLElement;
      const caption = document.querySelector(
        `[data-caption="${pairing.id}"]`,
      ) as HTMLElement;
      expect(sample.style.fontFamily).toBe(pairing.bodyFamily);
      expect(sample.style.fontWeight).toBe(String(pairing.displayWeight));
      expect(caption.style.fontFamily).toBe(pairing.uiFamily);
    }
  });

  it("asks for every pairing's lettering so the samples are not all alike", async () => {
    // Not only the chosen one: an unloaded face paints as the fallback, and
    // every pairing here falls through the same fallback, so a picker that
    // loaded one face would offer four options that look identical.
    await renderSection();

    expect(vi.mocked(loadPairingFonts).mock.calls.map(([p]) => p)).toEqual(
      FETCHED,
    );
    // Both scripts of the sample, so the Japanese line's subset is asked
    // for too — the Latin default would report ready without it.
    const [, text] = vi.mocked(loadPairingFonts).mock.calls[0];
    expect(text).toContain("Rain on the old stones");
    expect(text).toContain("古池や　蛙飛びこむ");
  });
});

describe("FontPairingSection while the lettering is still coming", () => {
  it("says a sample is loading rather than showing the wrong face", async () => {
    stillLoading();

    await renderSection();

    expect(loadingLines()).toHaveLength(FETCHED.length);
    for (const pairing of FETCHED) expect(sampleOf(pairing)).toBeNull();
  });

  it("never says the built-in pairing is loading", async () => {
    // Both its families are linked from index.html, so it is on screen from
    // the first paint — saying otherwise would be a lie about the one
    // option that is always ready.
    stillLoading();

    await renderSection();

    expect(sampleOf(DEFAULT_FONT_PAIRING)).toBeInTheDocument();
  });

  it("shows the sample the moment its lettering arrives", async () => {
    const arrivals: Array<() => void> = [];
    everyPairing(
      () => new Promise<void>((resolve) => arrivals.push(resolve)),
    );

    await renderSection();
    expect(loadingLines()).not.toHaveLength(0);

    await act(async () => {
      for (const arrive of arrivals) arrive();
    });

    expect(loadingLines()).toHaveLength(0);
    for (const pairing of FONT_PAIRINGS) {
      expect(sampleOf(pairing)).toBeInTheDocument();
    }
  });

  it("shows the sample anyway, and says so, when the lettering fails", async () => {
    // Never a dead end: she can still choose it, and the swap happens by
    // itself if the face turns up later.
    everyPairing(() => Promise.reject(new Error("offline")));

    await renderSection();

    expect(loadingLines()).toHaveLength(0);
    expect(sampleOf(CUSTOM)).toBeInTheDocument();
    expect(
      screen.getAllByText(/This lettering is still on its way/),
    ).toHaveLength(FETCHED.length);
  });

  it("stops waiting after a while rather than sitting there", async () => {
    vi.useFakeTimers();
    stillLoading();
    try {
      render(
        <FontPairingSection
          settings={{ backgroundPhoto: "" }}
          onChange={vi.fn()}
        />,
      );
      await act(async () => {});
      expect(loadingLines()).not.toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      expect(loadingLines()).toHaveLength(0);
      expect(sampleOf(CUSTOM)).toBeInTheDocument();
      expect(
        screen.getAllByText(/This lettering is still on its way/),
      ).toHaveLength(FETCHED.length);
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
