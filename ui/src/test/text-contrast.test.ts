import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The public haiku/haiga/photography pages render their attribution and
// caption lines as small secondary text on a translucent card that floats
// over the background photo. Because the card is translucent (and the photo
// is admin-selectable), "does this text read?" cannot be eyeballed from the
// declared colours alone — the card's rendered lightness moves with whatever
// photo is behind it.
//
// These tests pin the contract that came out of #343: one shared colour
// token for all of that secondary text, dark enough to stay comfortably
// legible across the whole range of card lightness, and not set in the
// body's hairline 300 weight (which is what made 14-16px grey text read as
// washed out even at a nominally passing ratio).
//
// The admin side reuses the same token on the same translucent backing
// (#354), and the file also pins foregrounds that must not be left to
// inheritance to come out legible (#347).

// Comments are stripped so an explanatory `/* ... */` between declarations
// can't hide the declaration that follows it from the regexes below.
const read = (path: string) =>
  readFileSync(`src/${path}`, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The declarations of the first rule whose selector list contains exactly
 * `selector` — so a rule shared by grouped selectors (`.a, .b { ... }`)
 * counts for each of them, while a descendant or compound selector that
 * merely mentions it (`.a .b`, `.a.compact`) does not.
 */
function ruleBlock(css: string, selector: string): string {
  for (const [, selectors, block] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (selectors.split(",").some((one) => one.trim() === selector)) {
      return block;
    }
  }
  throw new Error(`No rule found for "${selector}"`);
}

function declaration(css: string, selector: string, property: string): string {
  const block = ruleBlock(css, selector);
  const match = block.match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`),
  );
  if (!match) throw new Error(`"${selector}" declares no ${property}`);
  return match[1].trim();
}

type Rgb = [number, number, number];

/** The handful of CSS keyword colours this stylesheet set actually uses. */
const NAMED_COLORS: Record<string, Rgb> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
};

function parseColor(value: string): Rgb {
  const named = NAMED_COLORS[value.toLowerCase()];
  if (named) return named;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3)
    throw new Error(`Unparseable colour "${value}"`);
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function parseAlpha(value: string): number {
  const parts = value.match(/[\d.]+/g);
  return parts && parts.length > 3 ? Number(parts[3]) : 1;
}

/** `over` shown through `top` at `alpha` opacity. */
const composite = (top: Rgb, over: Rgb, alpha: number): Rgb =>
  top.map((c, i) => alpha * c + (1 - alpha) * over[i]) as Rgb;

const relativeLuminance = ([r, g, b]: Rgb): number => {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const indexCss = read("index.css");
const dataListCss = read("components/data-list/data-list.css");
const headerCss = read("components/header/header.css");
const haikuCss = read("components/haiku-content/haiku-content.css");
const haigaCss = read("components/haiga-content/haiga-content.css");
const photographyCss = read(
  "pages/photography-page/components/photography-post-content/photography-post-content.css",
);
const adminCss = read("pages/admin/admin.css");
const adminHaikuCss = read("pages/admin/admin-haiku-page/admin-haiku-page.css");
const adminItemListCss = read(
  "pages/admin/components/admin-item-list/admin-item-list.css",
);

/** Every public rule that renders small secondary text on the card. */
const SECONDARY_TEXT_RULES: ReadonlyArray<[string, string, string]> = [
  ["haiku attribution", haikuCss, ".haiku-list-publisher"],
  ["haiga attribution", haigaCss, ".haiga-list-publisher"],
  ["photography subtitle", photographyCss, ".photography-post-subtitle"],
  [
    "photography image caption",
    photographyCss,
    ".photography-post-image-caption",
  ],
];

/** A colour declaration, following one level of `var(--token)` to :root. */
function resolveColor(value: string): Rgb {
  const token = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return parseColor(token ? declaration(indexCss, ":root", token[1]) : value);
}

const mutedText = () => resolveColor("var(--muted-text)");

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const MID_GREY: Rgb = [128, 128, 128];

/** What every translucent surface sits on: the photo at partial opacity
    over the white page. Admins choose the photo, so this spans the full
    range from `backgroundLayerOver(BLACK)` to `backgroundLayerOver(WHITE)`. */
const backgroundLayerOver = (photo: Rgb): Rgb =>
  composite(
    photo,
    WHITE,
    Number(declaration(indexCss, "body::before", "opacity")),
  );

/** A translucent surface as it actually renders over a given photo. */
const surfaceOver = (photo: Rgb, tint: string): Rgb =>
  composite(parseColor(tint), backgroundLayerOver(photo), parseAlpha(tint));

// The card as it actually renders: a translucent panel over the background
// layer. The photo can be anything, so the card's lightness spans a range;
// `cardOver(photo)` gives the rendered card colour for a given photo.
const cardOver = (photo: Rgb): Rgb =>
  surfaceOver(photo, declaration(dataListCss, ".data-list", "background-color"));

describe("secondary text on the public cards", () => {
  it.each(SECONDARY_TEXT_RULES)(
    "%s uses the shared --muted-text token",
    (_name, css, selector) => {
      expect(declaration(css, selector, "color")).toBe("var(--muted-text)");
    },
  );

  it("meets WCAG AAA over a mid-lightness background photo", () => {
    expect(
      contrastRatio(mutedText(), cardOver(MID_GREY)),
    ).toBeGreaterThanOrEqual(7);
  });

  it("still meets WCAG AA over the darkest possible background photo", () => {
    expect(contrastRatio(mutedText(), cardOver(BLACK))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("still meets WCAG AA over the lightest possible background photo", () => {
    expect(contrastRatio(mutedText(), cardOver(WHITE))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("stays visually secondary to the body text it sits under", () => {
    const bodyText = parseColor(
      declaration(haikuCss, ".haiku-list-line", "color"),
    );
    const card = cardOver(MID_GREY);
    expect(contrastRatio(mutedText(), card)).toBeLessThan(
      contrastRatio(bodyText, card),
    );
  });

  it.each(SECONDARY_TEXT_RULES)(
    "%s opts out of the body's hairline weight",
    (_name, css, selector) => {
      expect(
        Number(declaration(css, selector, "font-weight")),
      ).toBeGreaterThanOrEqual(400);
    },
  );
});

// The admin panels are the same translucent grey over the same background
// photo as the public cards, so the same token — and the contrast argument
// above — applies to their secondary text (#354).
const ADMIN_SECONDARY_TEXT_RULES: ReadonlyArray<[string, string, string]> = [
  ["sidebar menu item", adminCss, ".admin-menu-item"],
  ["empty-result notice", adminItemListCss, ".admin-data-list-empty"],
  ["search match count", adminItemListCss, ".admin-data-list-count"],
  ["haiku list publisher", adminHaikuCss, ".admin-haiku-list-publisher"],
];

/** Every admin surface the rules above render their text on. */
const ADMIN_PANELS: ReadonlyArray<[string, string, string]> = [
  ["sidebar", adminCss, ".admin-menu"],
  ["empty-result notice", adminItemListCss, ".admin-data-list-empty"],
  ["search match count", adminItemListCss, ".admin-data-list-count"],
  ["list row", adminItemListCss, ".admin-data-list-item"],
];

describe("secondary text in the admin panels", () => {
  it.each(ADMIN_SECONDARY_TEXT_RULES)(
    "%s uses the shared --muted-text token",
    (_name, css, selector) => {
      expect(declaration(css, selector, "color")).toBe("var(--muted-text)");
    },
  );

  it.each(ADMIN_PANELS)(
    "%s is the same translucent backing as the public card",
    (_name, css, selector) => {
      expect(declaration(css, selector, "background-color")).toBe(
        declaration(dataListCss, ".data-list", "background-color"),
      );
    },
  );
});

// The icon on a filled control is only legible because of the colour
// declared on the control. `color: inherit` made that lightness an accident
// of whichever ancestor last set a colour — one dark-text ancestor away from
// a dark icon on the dark brown fill (#347).
describe("the admin icon buttons", () => {
  const foreground = () => declaration(adminCss, ".admin-icon-button", "color");

  it("declare their own foreground rather than inheriting one", () => {
    expect(foreground()).not.toBe("inherit");
  });

  it("put an icon on their fill that meets WCAG AA", () => {
    const fill = parseColor(
      declaration(adminCss, ".admin-icon-button", "background-color"),
    );
    expect(
      contrastRatio(resolveColor(foreground()), fill),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// The header bar is translucent over the same background layer, so the same
// argument applies -- with one extra twist: the bar spans the full width, so
// its contrast depended not just on WHICH photo is set but on which PART of
// it happened to land underneath. At 834px a bright patch sat under the
// right-hand end and the last nav links ("Other works", "Photography") read
// white-on-pale while the rest of the nav read fine (#392); the admin
// header's user name and logout icon sit in that same right-hand end.
//
// So the floor here is pinned at the extreme: the tint has to carry the
// contrast on its own over a pure-white photo, rather than borrowing it
// from the dark part of whichever photo is currently set.
const HEADER_BARS: ReadonlyArray<[string, string]> = [
  ["public header", ".header"],
  ["admin header", ".admin-header"],
];

const headerOver = (photo: Rgb, selector: string): Rgb =>
  surfaceOver(photo, declaration(headerCss, selector, "background-color"));

describe("the header bar over the background photo", () => {
  it("puts its nav links in the header's own foreground colour", () => {
    expect(declaration(headerCss, ".pages a", "color")).toBe(
      declaration(headerCss, ".header", "color"),
    );
  });

  it.each(HEADER_BARS)(
    "%s keeps white text at WCAG AAA over the lightest possible photo",
    (_name, selector) => {
      expect(
        contrastRatio(WHITE, headerOver(WHITE, selector)),
      ).toBeGreaterThanOrEqual(7);
    },
  );

  it("keeps the admin user name at WCAG AA over the lightest possible photo", () => {
    expect(
      contrastRatio(
        resolveColor(declaration(headerCss, ".header-user-name", "color")),
        headerOver(WHITE, ".admin-header"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(HEADER_BARS)(
    "%s renders as much the same bar over a light photo as a dark one",
    (_name, selector) => {
      // Not just legible everywhere but evenly so: a bar whose two ends
      // read as different shades is what made the nav look patchy.
      expect(
        contrastRatio(headerOver(WHITE, selector), headerOver(BLACK, selector)),
      ).toBeLessThanOrEqual(1.5);
    },
  );
});
