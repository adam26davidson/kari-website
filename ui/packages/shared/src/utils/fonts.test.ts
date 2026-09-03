import { describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_FONT_PAIRING,
  FONT_PAIRINGS,
  ensureFontStylesheet,
  fontStylesheetUrl,
  getFontPairing,
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
