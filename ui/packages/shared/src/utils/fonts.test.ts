import { describe, expect, it, afterEach, vi } from "vitest";
import {
  DEFAULT_FONT_PAIRING,
  FONT_PAIRINGS,
  ensureFontStylesheet,
  fontStylesheetUrl,
  getFontPairing,
  loadPairingFonts,
  resolveFontPairing,
} from "./fonts";

const injectedLinks = () =>
  Array.from(document.head.querySelectorAll("link[data-font-pairing]"));

afterEach(() => {
  for (const link of injectedLinks()) link.remove();
});

describe("the font pairing allowlist", () => {
  it("gives every pairing a distinct id", () => {
    const ids = FONT_PAIRINGS.map((pairing) => pairing.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers the built-in pairing first, stored as an empty id", () => {
    expect(FONT_PAIRINGS[0]).toBe(DEFAULT_FONT_PAIRING);
    expect(DEFAULT_FONT_PAIRING.id).toBe("");
    // The built-in families are already in both index.html files, so this
    // one entry has no stylesheet of its own to fetch.
    expect(DEFAULT_FONT_PAIRING.googleFamilies).toEqual([]);
  });

  it("keeps Noto Serif JP behind every other body face", () => {
    // The haiku and haiga pages carry Japanese. Noto Serif JP is loaded on
    // every page regardless, so naming it as the next stack entry means
    // both the swap interval and any glyph the chosen face lacks land on
    // today's appearance rather than on a browser default serif.
    for (const pairing of FONT_PAIRINGS.slice(1)) {
      expect(pairing.bodyFamily).toContain('"Noto Serif JP"');
      expect(pairing.bodyFamily.endsWith("serif")).toBe(true);
      expect(pairing.uiFamily).toContain('"Roboto"');
    }
  });

  it("asks Google for both of a pairing's families, and for nothing else", () => {
    for (const pairing of FONT_PAIRINGS.slice(1)) {
      expect(pairing.googleFamilies).toHaveLength(2);
      for (const family of pairing.googleFamilies) {
        // "Family Name:wght@400;700" — the name has to be the one the
        // stack asks for, or the page renders the fallback.
        const name = family.split(":")[0];
        expect(`${pairing.bodyFamily} ${pairing.uiFamily}`).toContain(
          `"${name}"`,
        );
      }
    }
  });

  it("spends the light display weight only where the face has one", () => {
    // Noto Serif JP ships 200..900; the mincho faces start at 400, so a
    // 300 there is synthesised or ignored, never the airy stem the token
    // exists for.
    expect(DEFAULT_FONT_PAIRING.displayWeight).toBe(300);
    for (const pairing of FONT_PAIRINGS.slice(1)) {
      expect(pairing.displayWeight).toBe(400);
    }
  });
});

describe("getFontPairing", () => {
  it("finds a pairing by the id the settings store", () => {
    const pairing = FONT_PAIRINGS[1];
    expect(getFontPairing(pairing.id)).toBe(pairing);
  });

  it.each([
    ["an empty id", ""],
    ["an absent field", undefined],
    ["an id we do not ship", "helvetica-forever"],
  ])("treats %s as no pairing at all", (_name, id) => {
    // All three mean "leave the stylesheet holding its own defaults",
    // which is what makes an unset setting and a corrupt one equally safe.
    expect(getFontPairing(id)).toBeUndefined();
  });

  it("resolves those same cases to the built-in pairing for display", () => {
    // The picker has to show SOMETHING as selected; "nothing chosen" and
    // "the site's usual fonts" are the same choice to the person looking.
    expect(resolveFontPairing("")).toBe(DEFAULT_FONT_PAIRING);
    expect(resolveFontPairing(undefined)).toBe(DEFAULT_FONT_PAIRING);
    expect(resolveFontPairing("helvetica-forever")).toBe(DEFAULT_FONT_PAIRING);
    expect(resolveFontPairing(FONT_PAIRINGS[1].id)).toBe(FONT_PAIRINGS[1]);
  });
});

describe("fontStylesheetUrl", () => {
  it("builds the exact URL Google Fonts serves the pairing at", () => {
    const shippori = getFontPairing("shippori");
    expect(fontStylesheetUrl(shippori!)).toBe(
      "https://fonts.googleapis.com/css2" +
        "?family=Shippori+Mincho:wght@400;700" +
        "&family=Noto+Sans+JP:wght@400;700" +
        "&display=swap",
    );
  });

  it("asks for display=swap on every pairing", () => {
    for (const pairing of FONT_PAIRINGS.slice(1)) {
      // Without it the page renders nothing at all while the (large,
      // CJK-covering) files download.
      expect(fontStylesheetUrl(pairing)).toContain("&display=swap");
    }
  });

  it("has no URL for the built-in pairing", () => {
    // index.html already links it; a second request for the same families
    // would be pure waste.
    expect(fontStylesheetUrl(DEFAULT_FONT_PAIRING)).toBeUndefined();
  });
});

describe("ensureFontStylesheet", () => {
  it("adds the stylesheet link once, however often it is asked", () => {
    const pairing = FONT_PAIRINGS[1];

    ensureFontStylesheet(pairing);
    ensureFontStylesheet(pairing);

    const links = injectedLinks();
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("rel")).toBe("stylesheet");
    expect(links[0].getAttribute("href")).toBe(fontStylesheetUrl(pairing));
    expect(links[0].getAttribute("data-font-pairing")).toBe(pairing.id);
  });

  it("keeps one link per pairing, so the picker can sample them all", () => {
    for (const pairing of FONT_PAIRINGS) ensureFontStylesheet(pairing);

    expect(injectedLinks().map((link) => link.getAttribute("data-font-pairing")))
      .toEqual(FONT_PAIRINGS.slice(1).map((pairing) => pairing.id));
  });

  it("adds nothing for the built-in pairing", () => {
    ensureFontStylesheet(DEFAULT_FONT_PAIRING);

    expect(injectedLinks()).toHaveLength(0);
  });
});

describe("loadPairingFonts", () => {
  const PAIRING = FONT_PAIRINGS[1];

  /**
   * Stands in for the Font Loading API jsdom does not implement, and hands
   * back the spy so a test can see what was asked for.
   *
   * Every test passes its OWN sample text: the module caches one promise
   * per pairing-and-text, deliberately and for the whole session, so tests
   * sharing a string would share its result too.
   */
  function stubFontFaceSet() {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load },
    });
    return load;
  }

  afterEach(() => {
    // `document.fonts` is absent in jsdom, so the stub is removed rather
    // than restored — leaving it would make the "no Font Loading API" case
    // below depend on which tests ran first.
    delete (document as { fonts?: unknown }).fonts;
  });

  it("resolves at once for the built-in pairing", async () => {
    // Both its families are linked from index.html, so there is nothing to
    // wait for — and nothing to add to the head either.
    stubFontFaceSet();

    await expect(
      loadPairingFonts(DEFAULT_FONT_PAIRING, "built-in"),
    ).resolves.toBeUndefined();
    expect(injectedLinks()).toHaveLength(0);
  });

  it("resolves without a Font Loading API rather than waiting forever", async () => {
    // jsdom, and browsers old enough not to matter: the stylesheet is in
    // the head and the page behaves as it did before this existed.
    expect(document.fonts).toBeUndefined();

    await expect(
      loadPairingFonts(PAIRING, "no font loading api"),
    ).resolves.toBeUndefined();
    expect(injectedLinks()).toHaveLength(1);
  });

  it("waits for the stylesheet before asking for its faces", async () => {
    // Load-bearing order: document.fonts.load() can only match a family the
    // document has heard of, and it hears of it when the stylesheet is
    // parsed. Asked earlier it resolves empty and reports success.
    const load = stubFontFaceSet();
    const text = "waits for the stylesheet";

    const loading = loadPairingFonts(PAIRING, text);
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();

    injectedLinks()[0].dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBeUndefined();

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith(
      `${PAIRING.displayWeight} 1em ${PAIRING.bodyFamily}`,
      text,
    );
    expect(load).toHaveBeenCalledWith(`1em ${PAIRING.uiFamily}`, text);
  });

  it("asks for the faces straight away when the stylesheet is already parsed", async () => {
    // A link put in the head earlier has fired its load event already; a
    // second wait for it would never end.
    const load = stubFontFaceSet();
    ensureFontStylesheet(PAIRING);
    Object.defineProperty(injectedLinks()[0], "sheet", { value: {} });

    await expect(
      loadPairingFonts(PAIRING, "already parsed"),
    ).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fails when the stylesheet cannot be fetched", async () => {
    const load = stubFontFaceSet();

    const loading = loadPairingFonts(PAIRING, "stylesheet fails");
    await Promise.resolve();
    injectedLinks()[0].dispatchEvent(new Event("error"));

    await expect(loading).rejects.toThrow(/Could not load the stylesheet/);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads a pairing once however often it is asked for", async () => {
    const load = stubFontFaceSet();
    const text = "asked twice";

    const first = loadPairingFonts(PAIRING, text);
    const second = loadPairingFonts(PAIRING, text);
    await Promise.resolve();
    injectedLinks()[0].dispatchEvent(new Event("load"));
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(injectedLinks()).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
