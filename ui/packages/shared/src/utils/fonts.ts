/**
 * The typeface pairings the site can be set to (#483).
 *
 * A hand-picked list rather than a free-text family name. A name typed into
 * a field would mean an arbitrary third-party request from every visitor's
 * browser, and a typo would show up as the site quietly rendering in a
 * browser default — a failure nobody in the admin would ever see. A short
 * allowlist means every choice has been looked at on the real pages, and
 * "unknown id" has one safe meaning: the site's usual fonts.
 *
 * Each entry names the two stacks the `--font-body` / `--font-ui` tokens are
 * set to (see packages/shared/src/styles/index.css) and the weight the
 * `--display-weight` token takes with it. The weight is per pairing because
 * Noto Serif JP ships 200..900 while the mincho faces below start at 400: a
 * 300 there is a browser-synthesised approximation at best, so each pairing
 * carries the lightest weight its own face actually has.
 *
 * Every body face here covers Japanese, because the haiku and haiga pages
 * carry it, and every non-default stack falls through Noto Serif JP before
 * the generic — that face is linked on every page anyway, so both the swap
 * interval and any missing glyph land on today's appearance.
 */
export interface FontPairing {
  /**
   * What site-settings.json stores. The built-in pairing is "", so an
   * absent field, an empty one and "put it back" are all the same value.
   */
  id: string;
  /** What the admin picker calls it — a feeling, never a family name. */
  label: string;
  /** One line under the label, in the same plain language. */
  description: string;
  /** The stack `--font-body` becomes. */
  bodyFamily: string;
  /** The stack `--font-ui` becomes. */
  uiFamily: string;
  /** The weight `--display-weight` becomes. */
  displayWeight: number;
  /**
   * Google Fonts `family=` specifications, family name and weights, in the
   * order the URL should list them. Empty for the built-in pairing, whose
   * families both index.html files already link statically.
   */
  googleFamilies: ReadonlyArray<string>;
}

/**
 * In picker order, built-in first. Weights: 400 for reading and 700 because
 * the active nav link and the blog HTML's <strong> are bold; no other weight
 * is used by any rule the tokens reach.
 */
export const FONT_PAIRINGS: ReadonlyArray<FontPairing> = [
  {
    id: "",
    label: "The site's usual fonts",
    description: "What the site has always been set in.",
    bodyFamily: '"Noto Serif JP", serif',
    uiFamily: '"Roboto", sans-serif',
    displayWeight: 300,
    googleFamilies: [],
  },
  {
    id: "shippori",
    label: "Calligraphic",
    description: "Softer strokes, a little closer to brush writing.",
    bodyFamily: '"Shippori Mincho", "Noto Serif JP", serif',
    uiFamily: '"Noto Sans JP", "Roboto", sans-serif',
    displayWeight: 400,
    googleFamilies: [
      "Shippori Mincho:wght@400;700",
      "Noto Sans JP:wght@400;700",
    ],
  },
  {
    id: "zen",
    label: "Bookish",
    description: "Even, classical letters, like a printed poetry book.",
    bodyFamily: '"Zen Old Mincho", "Noto Serif JP", serif',
    uiFamily: '"Zen Kaku Gothic New", "Roboto", sans-serif',
    displayWeight: 400,
    googleFamilies: [
      "Zen Old Mincho:wght@400;700",
      "Zen Kaku Gothic New:wght@400;700",
    ],
  },
  {
    id: "kaisei",
    label: "Rounded",
    description: "Warmer, rounder letters with a gentle edge.",
    bodyFamily: '"Kaisei Tokumin", "Noto Serif JP", serif',
    uiFamily: '"M PLUS 1p", "Roboto", sans-serif',
    displayWeight: 400,
    googleFamilies: ["Kaisei Tokumin:wght@400;700", "M PLUS 1p:wght@400;700"],
  },
];

/** The site's built-in pairing: what every fallback path lands on. */
export const DEFAULT_FONT_PAIRING = FONT_PAIRINGS[0];

/**
 * The pairing a stored id names, or undefined when it names none — which an
 * absent field, "" and an id we no longer ship all do. Undefined means
 * "set no font properties", and an unset token is exactly what makes the
 * stylesheet paint the built-in pairing, so the three degrade identically.
 */
export const getFontPairing = (
  id: string | undefined,
): FontPairing | undefined =>
  id ? FONT_PAIRINGS.find((pairing) => pairing.id === id) : undefined;

/**
 * The same lookup for anything that has to SHOW a choice: the picker needs
 * a selected option, and "nothing chosen" reads to the person looking as
 * "the site's usual fonts", which is what it renders as.
 */
export const resolveFontPairing = (id: string | undefined): FontPairing =>
  getFontPairing(id) ?? DEFAULT_FONT_PAIRING;

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";

/** Marks the links this module owns, and says which pairing each is for. */
const PAIRING_ATTRIBUTE = "data-font-pairing";

/**
 * Where a pairing's stylesheet lives, or undefined for the built-in one,
 * whose families are already linked from index.html.
 *
 * `display=swap` matters more here than on the static links: these files
 * cover CJK and are large, and without it the page renders no text at all
 * until they arrive.
 */
export function fontStylesheetUrl(pairing: FontPairing): string | undefined {
  if (pairing.googleFamilies.length === 0) return undefined;
  const families = pairing.googleFamilies
    .map((family) => `family=${family.replaceAll(" ", "+")}`)
    .join("&");
  return `${GOOGLE_FONTS_CSS}?${families}&display=swap`;
}

/**
 * Loads a pairing's stylesheet, once. Called both by the public site (for
 * the chosen pairing) and by the admin picker (for every pairing, so its
 * samples render in the faces they name).
 *
 * Deliberately never removes the link: the stylesheet is cached and inert
 * once the fonts it names are unused, so taking it away buys nothing and
 * costs a fresh swap interval if the same pairing is applied again.
 */
export function ensureFontStylesheet(pairing: FontPairing): void {
  ensureFontStylesheetLink(pairing);
}

/**
 * The same thing, handing back the `<link>` so a caller can wait on it.
 * Undefined for the built-in pairing, which has no stylesheet of its own.
 */
function ensureFontStylesheetLink(
  pairing: FontPairing,
): HTMLLinkElement | undefined {
  const href = fontStylesheetUrl(pairing);
  if (href === undefined) return undefined;
  const selector = `link[${PAIRING_ATTRIBUTE}="${pairing.id}"]`;
  const existing = document.head.querySelector<HTMLLinkElement>(selector);
  if (existing) return existing;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute(PAIRING_ATTRIBUTE, pairing.id);
  document.head.append(link);
  return link;
}

/**
 * Resolves once a stylesheet link has been parsed; rejects if it cannot be
 * fetched at all.
 *
 * A link that already has a `sheet` has been parsed already, and its `load`
 * event is in the past — waiting for another one would wait forever. That
 * is the ordinary case for a pairing whose link `ensureFontStylesheet` put
 * in the head earlier.
 */
function stylesheetParsed(link: HTMLLinkElement): Promise<void> {
  if (link.sheet) return Promise.resolve();
  return new Promise((resolve, reject) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error(`Could not load the stylesheet at ${link.href}`)),
      { once: true },
    );
  });
}

/** One promise per pairing-and-text, so asking twice costs one load. */
const pairingFontLoads = new Map<string, Promise<void>>();

/**
 * Resolves once a pairing's two faces are actually ready to paint `text`,
 * and rejects if they cannot be fetched.
 *
 * `ensureFontStylesheet` alone guarantees nothing about completion: a
 * sample rendered in a face the browser has not downloaded yet paints in
 * the fallback, which for these pairings is the same face for all of them
 * (see the note on FontPairing). Without this, the admin's font picker can
 * show four options that look identical and give no sign that anything is
 * still coming (#816).
 *
 * The order matters. `document.fonts.load()` can only match a family the
 * document has HEARD of, and a family is only registered once the
 * stylesheet naming it has been parsed — asked before that, it resolves
 * with an empty list and reports success for a face that has not been
 * requested at all. So the link's own load comes first.
 *
 * `text` is the words that will actually be shown. Google serves these
 * families split by `unicode-range`, so a sample carrying Japanese needs
 * its subsets asked for by name; the default probe string is Latin-only
 * and would report ready while the Japanese line still paints in the
 * fallback.
 */
export function loadPairingFonts(
  pairing: FontPairing,
  text: string,
): Promise<void> {
  const key = `${pairing.id} ${text}`;
  const started = pairingFontLoads.get(key);
  if (started) return started;
  const loading = loadPairingFontFaces(pairing, text);
  pairingFontLoads.set(key, loading);
  return loading;
}

async function loadPairingFontFaces(
  pairing: FontPairing,
  text: string,
): Promise<void> {
  const link = ensureFontStylesheetLink(pairing);
  // The built-in pairing: both index.html files link its families, so
  // there is nothing of its own to wait for.
  if (link === undefined) return;
  // No Font Loading API (jsdom, and browsers old enough not to matter):
  // the stylesheet is in the head and the page behaves exactly as it did
  // before this function existed. Claiming "still loading" forever would
  // be worse than the race it replaces.
  if (!document.fonts) return;
  await stylesheetParsed(link);
  await Promise.all([
    document.fonts.load(`${pairing.displayWeight} 1em ${pairing.bodyFamily}`, text),
    document.fonts.load(`1em ${pairing.uiFamily}`, text),
  ]);
}
