// Colour arithmetic for the admin-settable header colours (#482): parsing
// the stored hex values, compositing a translucent bar over a backdrop, and
// the WCAG contrast ratio the admin UI warns on before a save.
//
// Deliberately hex-only. The stored format is the one the admin UI writes
// (see SiteSettings in models.ts), so anything else is either a hand-edit
// or corruption — and a value that cannot be parsed cannot be checked for
// contrast either. Everything here is pure: the DOM-facing half lives in
// useSiteBackground, the picker half in the admin app.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

/**
 * The header's built-in colours — the same values header.css paints when no
 * setting is present, kept here so the admin UI can show and preview the
 * default without hard-coding it a second time. The bar is a base colour
 * plus an opacity because that is how the picker edits it (swatch plus
 * slider) and how the stylesheet's `rgba()` fallback states it; they are
 * composed into `#rrggbbaa` only on the way to being stored.
 *
 * ui/test/design/text-contrast.test.ts pins these against header.css so the
 * two cannot drift.
 */
export const HEADER_COLOR_DEFAULTS = {
  background: "#1c3100",
  backgroundAlpha: 0.86,
  title: "#ffffff",
  nav: "#ffffff",
} as const;

/** WCAG AA for normal text — the line the admin's warning is drawn at. */
export const CONTRAST_AA = 4.5;

const HEX_COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Whether `value` is a `#rrggbb` or `#rrggbbaa` colour, and nothing else. */
export const isHexColor = (value: string): boolean => HEX_COLOR.test(value);

/** The channels of a value already known to be a hex colour. */
const channelsOf = (value: string): Rgba => {
  const digits = value.slice(1);
  const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: digits.length === 8 ? channel(6) / 255 : 1,
  };
};

/** `value`'s channels, with alpha in 0..1, or null if it is not a hex colour. */
export const parseHexColor = (value: string): Rgba | null =>
  isHexColor(value) ? channelsOf(value) : null;

/** `top` painted over the opaque backdrop `over`. */
export const compositeOver = (top: Rgba, over: Rgb): Rgb => ({
  r: top.a * top.r + (1 - top.a) * over.r,
  g: top.a * top.g + (1 - top.a) * over.g,
  b: top.a * top.b + (1 - top.a) * over.b,
});

/** WCAG relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1..21, whichever order the two colours are given in. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** `#rrggbb` plus an alpha in 0..1, as the stored `#rrggbbaa`. */
export const composeHexAlpha = (color: string, alpha: number): string =>
  color +
  Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");

/**
 * The two halves the picker edits separately. `value` must already be a hex
 * colour (guard with `isHexColor`); a six-digit one is fully opaque.
 */
export function splitHexAlpha(value: string): {
  color: string;
  alpha: number;
} {
  return {
    color: value.slice(0, 7).toLowerCase(),
    alpha: value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1,
  };
}

/** The header colours a settings object actually paints. */
export interface HeaderColors {
  /** The bar's opaque base colour, `#rrggbb`. */
  background: string;
  /** How much of that colour the bar shows, 0..1. */
  backgroundAlpha: number;
  title: string;
  nav: string;
}

const orDefault = (value: string | undefined, fallback: string): string =>
  value !== undefined && isHexColor(value) ? value : fallback;

/**
 * What the header will actually look like for a given settings object, with
 * the built-in colour standing in wherever a setting is absent, empty or
 * unparseable — exactly the substitution header.css's `var()` fallbacks
 * make. The admin page previews and contrast-checks this rather than the
 * raw fields, so what it shows is what a visitor would get.
 */
export function resolveHeaderColors(settings: {
  headerBackgroundColor?: string;
  headerTitleColor?: string;
  headerNavColor?: string;
}): HeaderColors {
  const bar = orDefault(settings.headerBackgroundColor, "");
  const { color, alpha } = bar
    ? splitHexAlpha(bar)
    : {
        color: HEADER_COLOR_DEFAULTS.background,
        alpha: HEADER_COLOR_DEFAULTS.backgroundAlpha,
      };
  return {
    background: color,
    backgroundAlpha: alpha,
    title: orDefault(settings.headerTitleColor, HEADER_COLOR_DEFAULTS.title),
    nav: orDefault(settings.headerNavColor, HEADER_COLOR_DEFAULTS.nav),
  };
}

/**
 * How well each of the two header foregrounds reads on the bar, as WCAG
 * ratios.
 *
 * The bar is translucent over a photo the admin also chooses, so there is
 * no single backdrop to measure against: the answer is taken at the WORSE
 * of the two extremes, the bar over pure white and the bar over pure
 * black. That is stricter than any real page — `body::before`'s opacity
 * means the backdrop never actually reaches white — and deliberately so.
 * It is what keeps the property #392 was fixed to establish: the tint has
 * to carry the contrast on its own, whatever photograph is behind it.
 */
export function headerContrast(colors: HeaderColors): {
  title: number;
  nav: number;
} {
  const bar: Rgba = { ...channelsOf(colors.background), a: colors.backgroundAlpha };
  const overWhite = compositeOver(bar, { r: 255, g: 255, b: 255 });
  const overBlack = compositeOver(bar, { r: 0, g: 0, b: 0 });
  const worst = (foreground: string) =>
    Math.min(
      contrastRatio(channelsOf(foreground), overWhite),
      contrastRatio(channelsOf(foreground), overBlack),
    );
  return { title: worst(colors.title), nav: worst(colors.nav) };
}
