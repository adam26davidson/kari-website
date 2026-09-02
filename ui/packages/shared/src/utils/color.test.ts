import { describe, it, expect } from "vitest";
import {
  composeHexAlpha,
  compositeOver,
  contrastRatio,
  CONTRAST_AA,
  headerContrast,
  HEADER_COLOR_DEFAULTS,
  isHexColor,
  parseHexColor,
  resolveHeaderColors,
  splitHexAlpha,
} from "./color";

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

describe("isHexColor", () => {
  it.each([
    ["six digits", "#1c3100"],
    ["eight digits", "#1c3100db"],
    ["uppercase", "#1C3100DB"],
  ])("accepts %s", (_name, value) => {
    expect(isHexColor(value)).toBe(true);
  });

  it.each([
    ["a keyword", "red"],
    ["a three-digit shorthand", "#abc"],
    ["a truncated hex", "#12345"],
    ["an rgba() function", "rgba(28, 49, 0, 0.86)"],
    ["a hex without its hash", "1c3100"],
    ["a non-hex digit", "#1c31zz"],
    ["the empty string", ""],
    // The one that matters most: a value with anything appended could
    // otherwise smuggle arbitrary CSS into the custom property.
    ["a hex with a suffix", "#1c3100; display: none"],
  ])("rejects %s", (_name, value) => {
    expect(isHexColor(value)).toBe(false);
  });
});

describe("parseHexColor", () => {
  it("reads the channels of a six-digit hex as fully opaque", () => {
    expect(parseHexColor("#1c3100")).toEqual({ r: 28, g: 49, b: 0, a: 1 });
  });

  it("reads the fourth channel of an eight-digit hex as alpha", () => {
    expect(parseHexColor("#1c310080")).toEqual({
      r: 28,
      g: 49,
      b: 0,
      a: 128 / 255,
    });
  });

  it("returns null for a value that is not a hex colour", () => {
    expect(parseHexColor("rgba(0, 0, 0, 0.5)")).toBeNull();
  });
});

describe("compositeOver", () => {
  it("leaves a fully opaque colour alone", () => {
    expect(compositeOver({ ...BLACK, a: 1 }, WHITE)).toEqual(BLACK);
  });

  it("returns the backdrop for a fully transparent colour", () => {
    expect(compositeOver({ ...BLACK, a: 0 }, WHITE)).toEqual(WHITE);
  });

  it("mixes the two at a partial alpha", () => {
    expect(compositeOver({ ...BLACK, a: 0.5 }, WHITE)).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
    });
  });
});

describe("contrastRatio", () => {
  it("is 21 for black against white", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
  });

  it("does not depend on the order of its arguments", () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
  });

  it("is 1 for a colour against itself", () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it("clears WCAG AAA for the default header, worst case", () => {
    // The property #392/PR #477 established and this feature must not
    // lose: the default bar tint carries the contrast on its own, even
    // composited over a pure-white backdrop.
    const bar = parseHexColor(
      composeHexAlpha(
        HEADER_COLOR_DEFAULTS.background,
        HEADER_COLOR_DEFAULTS.backgroundAlpha,
      ),
    );
    const title = parseHexColor(HEADER_COLOR_DEFAULTS.title);
    expect(
      contrastRatio(title!, compositeOver(bar!, WHITE)),
    ).toBeGreaterThanOrEqual(7);
  });
});

describe("composeHexAlpha and splitHexAlpha", () => {
  it("appends the alpha channel as two hex digits", () => {
    expect(composeHexAlpha("#1c3100", 1)).toBe("#1c3100ff");
    expect(composeHexAlpha("#1c3100", 0)).toBe("#1c310000");
    expect(composeHexAlpha("#1c3100", 0.5)).toBe("#1c310080");
  });

  it("splits an eight-digit hex back into its colour and alpha", () => {
    expect(splitHexAlpha("#1c310080")).toEqual({
      color: "#1c3100",
      alpha: 128 / 255,
    });
  });

  it("treats a six-digit hex as fully opaque", () => {
    expect(splitHexAlpha("#1c3100")).toEqual({ color: "#1c3100", alpha: 1 });
  });

  it("lowercases the colour half so two spellings compare equal", () => {
    expect(splitHexAlpha("#1C3100DB").color).toBe("#1c3100");
  });

  it("round-trips every alpha the opacity slider can produce", () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      const composed = composeHexAlpha("#1c3100", percent / 100);
      const split = splitHexAlpha(composed);
      expect(split.color).toBe("#1c3100");
      expect(Math.round(split.alpha * 100)).toBe(percent);
    }
  });
});

describe("resolveHeaderColors", () => {
  const DEFAULTS = {
    background: HEADER_COLOR_DEFAULTS.background,
    backgroundAlpha: HEADER_COLOR_DEFAULTS.backgroundAlpha,
    title: HEADER_COLOR_DEFAULTS.title,
    nav: HEADER_COLOR_DEFAULTS.nav,
  };

  it("falls back to the built-in colours for a settings object without them", () => {
    // Every site-settings.json written before this feature is this shape.
    expect(resolveHeaderColors({})).toEqual(DEFAULTS);
  });

  it("treats an empty string the same as an absent field", () => {
    expect(
      resolveHeaderColors({
        headerBackgroundColor: "",
        headerTitleColor: "",
        headerNavColor: "",
      }),
    ).toEqual(DEFAULTS);
  });

  it("falls back for a value that is not a hex colour", () => {
    expect(
      resolveHeaderColors({
        headerBackgroundColor: "rebeccapurple",
        headerTitleColor: "#fff",
        headerNavColor: "rgb(0, 0, 0)",
      }),
    ).toEqual(DEFAULTS);
  });

  it("splits a stored bar colour into its colour and opacity", () => {
    expect(
      resolveHeaderColors({ headerBackgroundColor: "#10203080" }),
    ).toEqual({ ...DEFAULTS, background: "#102030", backgroundAlpha: 128 / 255 });
  });

  it("resolves each field independently of the other two", () => {
    expect(resolveHeaderColors({ headerNavColor: "#00ff00" })).toEqual({
      ...DEFAULTS,
      nav: "#00ff00",
    });
  });
});

describe("headerContrast", () => {
  const resolve = (settings: {
    headerBackgroundColor?: string;
    headerTitleColor?: string;
    headerNavColor?: string;
  }) => headerContrast(resolveHeaderColors(settings));

  it("clears WCAG AA for both foregrounds at the built-in colours", () => {
    const { title, nav } = resolve({});
    expect(title).toBeGreaterThanOrEqual(CONTRAST_AA);
    expect(nav).toBeGreaterThanOrEqual(CONTRAST_AA);
  });

  it("fails both foregrounds on a pale bar behind white text", () => {
    const { title, nav } = resolve({ headerBackgroundColor: "#f5f5f5ff" });
    expect(title).toBeLessThan(CONTRAST_AA);
    expect(nav).toBeLessThan(CONTRAST_AA);
  });

  it("reports the two foregrounds independently", () => {
    // A pale bar with a near-black title and the default white links: the
    // title reads, the links do not.
    const { title, nav } = resolve({
      headerBackgroundColor: "#f5f5f5ff",
      headerTitleColor: "#111111",
    });
    expect(title).toBeGreaterThanOrEqual(CONTRAST_AA);
    expect(nav).toBeLessThan(CONTRAST_AA);
  });

  it("judges a see-through bar at its worst backdrop, not its best", () => {
    // Nearly transparent: over black the white text is fine, over white it
    // vanishes — and the photo behind the bar decides which, so the worse
    // of the two is the honest answer.
    const seeThrough = { headerBackgroundColor: "#00000014" };
    expect(resolve(seeThrough).title).toBeLessThan(CONTRAST_AA);
    expect(
      contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }),
    ).toBeGreaterThan(CONTRAST_AA);
  });
});

