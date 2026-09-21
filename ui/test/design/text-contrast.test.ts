import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The public haiku/haiga/photography pages render their attribution and
// caption lines as small secondary text on a translucent card that floats
// over the background photo. Because the card is translucent (and the photo
// is admin-selectable), "does this text read?" cannot be eyeballed from the
// declared colours alone — the card's rendered lightness moves with whatever
// photo is behind it.
//
// These tests pin the colour half of the contract that came out of #343:
// one shared token for all of that secondary text, dark enough to stay
// comfortably legible across the whole range of card lightness. The weight
// half — the hairline 300 that made 14-16px grey text read as washed out
// even at a nominally passing ratio — now lives in the body default and the
// --display-weight token, pinned by type-scale.test.ts (#356).
//
// The admin is a different problem since #592: its surfaces are flat, so
// its pairs are checked as one foreground on one opaque fill rather than
// across a range. The file also pins foregrounds that must not be left to
// inheritance to come out legible (#347) and the keyboard focus ring, whose
// job is to read on every one of these surfaces at once (#501).

// Paths are ui-relative and resolved from this file's own location: the
// stylesheets these assertions span live in three workspaces (the public
// app, the admin app and the shared package), and nothing here should
// depend on the working directory vitest happens to run in.
const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Comments are stripped so an explanatory `/* ... */` between declarations
// can't hide the declaration that follows it from the regexes below.
const read = (path: string) =>
  readFileSync(`${UI_ROOT}${path}`, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The declarations of the first rule whose selector list contains exactly
 * `selector` — so a rule shared by grouped selectors (`.a, .b { ... }`)
 * counts for each of them, while a descendant or compound selector that
 * merely mentions it (`.a .b`, `.a.compact`) does not.
 */
function ruleBlock(css: string, selector: string): string {
  for (const [, prelude, block] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    // Everything up to the last `;` is a statement at-rule that ended
    // there (`@import "tailwindcss";`, `@source "…";`) rather than part of
    // the selector that follows it — without this, the first rule of the
    // admin's Tailwind entry stylesheet is named
    // `@import "tailwindcss"; @source "…"; :root` and no lookup finds it.
    const selectors = prelude.slice(prelude.lastIndexOf(";") + 1);
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

/**
 * The fallback half of a `var(--x, fallback)` declaration, or the value
 * unchanged when it is not one.
 *
 * Since #482 the header's three colours are admin-settable, so what the
 * stylesheet declares is "whatever is set, or this literal". The literal is
 * exactly what this file can and should pin: the DEFAULT appearance — what
 * every visitor sees until an admin changes it, and what an unset, empty,
 * corrupt or unfetchable setting falls back to. The chosen colours are
 * checked where they are chosen, by the contrast warning on the admin
 * Background page; a test of what a browser actually computes for a set
 * value would need computed styles rather than this parse (#481).
 */
function varFallback(value: string): string {
  const match = value.match(/^var\(\s*--[\w-]+\s*,([\s\S]+)\)$/);
  return match ? match[1].trim() : value;
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

const indexCss = read("packages/shared/src/styles/index.css");
const dataListCss = read("apps/public/src/components/data-list/data-list.css");
const headerCss = read("apps/public/src/components/header/header.css");
const haikuCss = read(
  "packages/shared/src/components/haiku-content/haiku-content.css",
);
const haigaCss = read(
  "packages/shared/src/components/haiga-content/haiga-content.css",
);
const photographyCss = read(
  "apps/public/src/pages/photography-page/components/" +
    "photography-post-content/photography-post-content.css",
);
const adminCss = read("apps/admin/src/admin.css");
const themeCss = read("apps/admin/src/styles/theme.css");
const backgroundCss = read("packages/shared/src/styles/background.css");
// Since #480 almost nothing in these stylesheets is a literal any more: the
// surfaces and the palette live as custom properties in the shared `:root`,
// the admin's theme re-points three of them for its own build, and an
// alpha variant is written as a `color-mix` on its base rather than as a
// second hex. So a declaration has to be RESOLVED before it can be
// composited, and the resolver below is what every assertion in this file
// goes through.

/**
 * The `:root` blocks a custom property may be declared in, in cascade
 * order: theme.css is imported LAST by the admin app and deliberately
 * re-declares two of the shared tokens (`--primary`, `--primary-hover`) as
 * the design boards' green, so it has to be consulted first or every admin
 * assertion below would vouch for the public site's brown instead of the
 * colour the admin actually paints (#592).
 *
 * The public assertions are unaffected: nothing on that side resolves
 * either of those two tokens, and the public build never loads theme.css.
 * `adminCss` is last and holds only `--admin-helper-reserve` now (#240),
 * but it stays in the chain so a token added there is still resolvable.
 */
const ROOT_SHEETS = [themeCss, indexCss, adminCss];

/** The value declared for `token`, in whichever `:root` declares it. */
function tokenValue(token: string): string {
  for (const css of ROOT_SHEETS) {
    const match = ruleBlock(css, ":root").match(
      new RegExp(`(?:^|;)\\s*${token}\\s*:\\s*([^;]+)`),
    );
    if (match) return match[1].trim();
  }
  throw new Error(`No :root declares ${token}`);
}

/** A colour and the opacity it is painted at. */
interface Surface {
  rgb: Rgb;
  alpha: number;
}

/**
 * A colour value with its indirections resolved: `var(--token)` followed to
 * whichever `:root` declares it, through as many aliases as it takes
 * (`--destructive` is `var(--maroon)`), and
 * `color-mix(in srgb, <colour> N%, transparent)` collapsed to that colour
 * at N% opacity — which is exactly what a browser paints for it, and what
 * the alpha-suffixed hexes these replaced used to say directly.
 */
function resolveSurface(value: string, depth = 0): Surface {
  if (depth > 8) throw new Error(`Colour reference loops at "${value}"`);
  const token = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (token) return resolveSurface(tokenValue(token[1]), depth + 1);
  const mix = value.match(
    /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/,
  );
  if (mix) {
    const base = resolveSurface(mix[1].trim(), depth + 1);
    return { rgb: base.rgb, alpha: base.alpha * (Number(mix[2]) / 100) };
  }
  return { rgb: parseColor(value), alpha: parseAlpha(value) };
}

/**
 * The one colour in a declaration, resolved. The value may be a shorthand
 * that carries other things too — `1px solid var(--destructive)`,
 * `0 0 0 4px var(--header-surface)`, `2px solid #ffffff`.
 */
function colorOf(value: string): Rgb {
  const trimmed = value.trim();
  // A whole-value function is taken whole: picking "the colour inside" a
  // `color-mix` with a regex would stop at the first `)`, which is the
  // one closing its `var()` argument.
  if (/^(?:var|color-mix)\(/.test(trimmed)) return resolveSurface(trimmed).rgb;
  const found = trimmed.match(
    /var\(\s*--[\w-]+\s*\)|#[0-9a-f]{3,8}|rgba?\([^)]*\)|\b(?:white|black)\b/i,
  );
  return resolveSurface(found?.[0] ?? trimmed).rgb;
}

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

const mutedText = () => colorOf("var(--muted-text)");

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const MID_GREY: Rgb = [128, 128, 128];

/** What every translucent surface sits on: the photo at partial opacity
    over the white page. Admins choose the photo, so this spans the full
    range from `backgroundLayerOver(BLACK)` to `backgroundLayerOver(WHITE)`.

    Read from background.css, the public-only stylesheet #240 split the
    photo out of index.css into — every surface composited in this file is
    a PUBLIC one, since the admin's are flat paper. */
const backgroundLayerOver = (photo: Rgb): Rgb =>
  composite(
    photo,
    WHITE,
    Number(declaration(backgroundCss, "body::before", "opacity")),
  );

/** A translucent surface as it actually renders over a given photo. */
const surfaceOver = (photo: Rgb, tint: string): Rgb => {
  const { rgb, alpha } = resolveSurface(tint);
  return composite(rgb, backgroundLayerOver(photo), alpha);
};

// The card as it actually renders: a translucent panel over the background
// layer. The photo can be anything, so the card's lightness spans a range;
// `cardOver(photo)` gives the rendered card colour for a given photo.
const cardOver = (photo: Rgb): Rgb =>
  surfaceOver(
    photo,
    declaration(dataListCss, ".data-list", "background-color"),
  );

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
    const bodyText = colorOf(
      declaration(haikuCss, ".haiku-list-line", "color"),
    );
    const card = cardOver(MID_GREY);
    expect(contrastRatio(mutedText(), card)).toBeLessThan(
      contrastRatio(bodyText, card),
    );
  });
});

// The admin's secondary text and panel surfaces were pinned here too: the
// legacy `admin-item-list` fork tinted its rows, header and empty notice
// from the same translucent grey as the public card and set their small
// text in the same `--muted-text` (#354). Both that fork and the `card`
// fork are gone (#240) — the admin is flat paper now and shares no
// surface with the public site, so its pairs are checked as opaque
// foreground-on-fill in "the admin's warm studio palette" below.

// Every admin section opens with an <h2> saying what the page is for. The
// body's default colour is --light-text, chosen for the public site's
// background photo and invisible on a pale surface, so a heading that
// leaves its colour to inheritance renders near-white. That is not
// hypothetical: the home-page editor shipped exactly that way while its
// four siblings each re-declared a dark colour of their own (#457). Every
// admin heading therefore has to STATE its colour, so the next section
// added cannot re-acquire the bug by omission.
const ADMIN_DIR = "apps/admin/src";

/** Every non-test `.tsx` in the admin app, as `read()` paths. */
function adminComponents(dir: string): string[] {
  return readdirSync(`${UI_ROOT}${dir}`, { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return adminComponents(path);
      return entry.isFile() &&
        entry.name.endsWith(".tsx") &&
        !entry.name.endsWith(".test.tsx")
        ? [path]
        : [];
    },
  );
}

/** Every `<h2 ...>` opening tag in the admin tree, with its file. */
const ADMIN_HEADINGS: ReadonlyArray<[string, string]> = adminComponents(
  ADMIN_DIR,
).flatMap((path) =>
  [...read(path).matchAll(/<h2[^>]*>/g)].map(
    ([tag]) => [path, tag] as [string, string],
  ),
);

describe("the admin section headings", () => {
  it("finds the heading of every admin section", () => {
    // Two, and exactly two components render one: the shared PageTitle
    // that every page's heading goes through, and the helper panel's
    // "Helper". The floor was 4 while the pre-shadcn item list and data
    // editor each carried their own; #240 deleted that pair and this is
    // the re-derivation (#898). A drop below this means the scan stopped
    // seeing what it is meant to check.
    expect(ADMIN_HEADINGS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(ADMIN_HEADINGS)(
    "%s states its heading colour rather than inheriting one",
    (_path, tag) => {
      // It is the invariant — no heading left to inherit --light-text —
      // that is pinned here, and since #240 there is one spelling of it:
      // every admin page is Tailwind and has no stylesheet to put a shared
      // class in, so it states the colour in the markup as
      // `text-foreground`, the Ink the deleted `.admin-section-heading`
      // used to spend. (That class was the other accepted spelling until
      // the stylesheet declaring it went.) The class list is read from the
      // whole tag because a heading composes its classes through `cn(...)`
      // rather than a plain string literal.
      const className = tag.match(/className="([^"]*)"/)?.[1] ?? tag;
      expect(/\btext-foreground\b/.test(className)).toBe(true);
    },
  );

  // ".admin-section-explanation" went with what's on test, its last
  // holder — #841 moved that page's explanation line to Tailwind's
  // `text-muted-foreground` on flat paper, which the palette checks below
  // cover; the test that kept it secondary to the heading went with it.
  // The heading's own legibility floor moved there too: Ink on the admin's
  // opaque card is "ink on a card" in the palette block, which is a
  // stronger claim (AAA) than the translucent-over-photo one this used to
  // make.
});

// "the admin icon buttons" was pinned here — the move arrows' glyph and
// ring against their own pale fill (#347, #457). Their rule was the last
// thing in admin.css that painted anything, and #240 deleted it with the
// rest of the legacy CSS: the arrows are shadcn `Button`s on the `icon`
// size now, drawing their maroon or Fir from the palette whose pairs the
// it.each below covers.

// ".admin-danger-banner" and the describe that pinned it went with what's
// on test, its last holder — #841 moved that page's truncation warning to
// Tailwind's `bg-destructive text-destructive-foreground`, the same pair
// image cleanup's error block wears, whose contrast "the destructive's
// label on its fill" already pins in the palette it.each above.

// The admin's own palette (#592), which is a different problem from every
// other block in this file: the admin dropped the background photo, so its
// surfaces are FLAT. There is no range of composited lightnesses to check
// against — each pair is one foreground on one opaque fill, and either it
// reads or it does not. What has to be pinned is that the seven colours the
// design boards chose actually pair the way the boards use them, because
// nothing else in the suite would notice a palette edit that left, say,
// Stone on Cream at 3.9:1.
describe("the admin's warm studio palette", () => {
  const token = (name: string) => colorOf(declaration(themeCss, ":root", name));

  /** A token over a surface, compositing if the token is translucent. */
  const over = (name: string, surface: string): Rgb => {
    const { rgb, alpha } = resolveSurface(declaration(themeCss, ":root", name));
    return composite(rgb, token(surface), alpha);
  };

  it.each([
    // Body text and headings, on the page and on a card. AAA, because
    // this is where she reads and writes for as long as she is here —
    // and, since #237's visual review, the editors' field labels too
    // (components/field-label), which the boards set in Ink beside the
    // value they name rather than in the muted tone.
    ["ink on paper", "--foreground", "--background", 7],
    ["ink on a card", "--foreground", "--card", 7],
    // The secondary weight, and only what is genuinely an aside: a hint
    // under a switch, the "changes appear once you save" line, a list
    // row's date, the sidebar's "YOUR WORKSHOP" and "Sign out". A card is
    // in the list because the editors' hints sit on one.
    ["stone on paper", "--muted-foreground", "--background", 4.5],
    ["stone on cream", "--muted-foreground", "--muted", 4.5],
    ["stone on a card", "--muted-foreground", "--card", 4.5],
    // The filled primary — Save, Add — and the filled destructive.
    [
      "the primary's label on its fill",
      "--primary-foreground",
      "--primary",
      4.5,
    ],
    [
      "the destructive's label on its fill",
      "--destructive-foreground",
      "--destructive",
      4.5,
    ],
    // Maroon as a foreground: "See your site", the phone menu's links out.
    ["maroon on paper", "--accent", "--background", 4.5],
    ["maroon on cream", "--accent", "--muted", 4.5],
  ])("keeps %s legible", (_pair, foreground, surface, floor) => {
    expect(
      contrastRatio(token(foreground), token(surface)),
    ).toBeGreaterThanOrEqual(floor);
  });

  // The active section's pill is the green at 11% on the cream sidebar,
  // with the same green as its label — a tint of the very colour it is
  // marking, so the text has to clear the tint it sits on rather than the
  // bare sidebar.
  it("keeps the current section's label legible on its own pill", () => {
    expect(
      contrastRatio(
        token("--sidebar-accent-foreground"),
        over("--sidebar-accent", "--sidebar"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // What makes every number above a whole answer rather than a best case:
  // the admin's page really is an opaque fill. The other half — that the
  // shared background photograph never reaches this app at all — is the
  // import boundary, pinned in test/config/app-boundaries.test.ts since
  // #240 moved `body::before` into its own public-only stylesheet. (Until
  // then theme.css cancelled it with `content: none`, and this case
  // checked that.)
  it("paints its page an opaque fill of its own", () => {
    expect(declaration(themeCss, "body", "background-color")).toBe(
      "var(--background)",
    );
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
];

const headerOver = (photo: Rgb, selector: string): Rgb =>
  surfaceOver(
    photo,
    varFallback(declaration(headerCss, selector, "background-color")),
  );

/** The default a header colour falls back to, as declared. */
const headerDefault = (selector: string, property: string): string =>
  varFallback(declaration(headerCss, selector, property));

/** One field of the shared HEADER_COLOR_DEFAULTS, as source text. */
const HEADER_COLOR_DEFAULTS_SOURCE = (read(
  "packages/shared/src/utils/color.ts",
).match(/HEADER_COLOR_DEFAULTS\s*=\s*\{([^}]*)\}/) ?? [])[1];

function headerColorDefault(field: string): string {
  const match = HEADER_COLOR_DEFAULTS_SOURCE?.match(
    new RegExp(`\\b${field}:\\s*"?([^",\\n]+)"?\\s*,`),
  );
  if (!match) throw new Error(`HEADER_COLOR_DEFAULTS declares no ${field}`);
  return match[1].trim();
}

describe("the header bar over the background photo", () => {
  it("puts its nav links in the header's own foreground colour", () => {
    // Compared as defaults: the link colour is settable and the bar's own
    // `color` is not, so what has to match is what each paints when
    // nothing is set.
    expect(colorOf(headerDefault(".pages a", "color"))).toEqual(
      colorOf(declaration(headerCss, ".header", "color")),
    );
  });

  // Three settings, three custom properties, one default each. The
  // stylesheet is the only place a default may live, so these pin that the
  // properties are wired at all and that the shared constant the admin
  // page previews and warns from is the same appearance.
  it.each([
    ["the bar tint", ".header", "background-color", "--header-background"],
    ["the site title", ".header-title", "color", "--header-title-color"],
    [
      "the mobile title",
      ".header-title-mobile",
      "color",
      "--header-title-color",
    ],
    ["the nav links", ".pages a", "color", "--header-nav-color"],
    ["the menu button", ".header-menu-button", "color", "--header-nav-color"],
  ])(
    "makes %s settable, with a default to fall back to",
    (_name, selector, property, token) => {
      const value = declaration(headerCss, selector, property);
      expect(value).toContain(`var(${token},`);
      expect(varFallback(value)).not.toBe(value);
    },
  );

  it("draws the hover underline in the nav link's own colour", () => {
    // The underline is the same mark as the word above it; a settable link
    // colour with a fixed underline would come apart on the first change.
    expect(declaration(headerCss, ".pages a:hover", "border-bottom")).toContain(
      "var(--header-nav-color,",
    );
  });

  it("shares one set of defaults with the admin colour picker", () => {
    // The admin page previews and contrast-checks against its own copy of
    // these colours; if the two drifted it would be checking a bar nobody
    // sees. Read as source text rather than imported, like every other
    // assertion in this file — and because importing a source module from
    // the config project puts a second, function-less coverage record on
    // it. Alpha compares to within a 0-255 step, which is as precisely as
    // the picker's #rrggbbaa can state the stylesheet's 0.86.
    const tint = resolveSurface(headerDefault(".header", "background-color"));
    expect(tint.rgb).toEqual(parseColor(headerColorDefault("background")));
    expect(tint.alpha).toBeCloseTo(
      Number(headerColorDefault("backgroundAlpha")),
      2,
    );
    expect(colorOf(headerDefault(".header-title", "color"))).toEqual(
      parseColor(headerColorDefault("title")),
    );
    expect(colorOf(headerDefault(".pages a", "color"))).toEqual(
      parseColor(headerColorDefault("nav")),
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

// The keyboard focus ring has the hardest job on the site: one rule has to
// stay visible on the near-black-green header bar AND on the near-white
// cards and admin panels floating over an admin-chosen photo. A single
// colour cannot do that, so the ring is two layers — a light inner outline
// inside a dark halo — and what these tests pin is that the two layers
// contrast with EACH OTHER, and that each one carries the ring on the
// surfaces where the other one would disappear (#501).
describe("the keyboard focus ring", () => {
  const outline = () => declaration(indexCss, ":focus-visible", "outline");
  const boxShadow = () => declaration(indexCss, ":focus-visible", "box-shadow");

  /** The px lengths of a value, in order. */
  const lengths = (value: string): number[] =>
    (value.match(/-?[\d.]+px/g) ?? []).map(Number.parseFloat);

  const lightLayer = () => colorOf(outline());
  // The halo is `var(--header-surface)` — deliberately the header bar's own
  // green rather than a near-miss, since the bar is one of the surfaces the
  // ring has to read on (#480).
  const darkLayer = () => colorOf(boxShadow());

  const outlineWidth = () => lengths(outline())[0];
  const outlineOffset = () =>
    Number.parseFloat(
      declaration(indexCss, ":focus-visible", "outline-offset"),
    );
  /** The last length of `0 0 0 <spread>` is the spread radius. */
  const shadowSpread = () => lengths(boxShadow()).at(-1) as number;

  it("draws a solid outline thick enough to see", () => {
    expect(outline()).toMatch(/\bsolid\b/);
    expect(outlineWidth()).toBeGreaterThanOrEqual(2);
  });

  it("wraps that outline in a halo that extends past it", () => {
    // The outline paints over the inner part of the spread, so the halo
    // needs at least the outline's own thickness plus a visible remainder.
    expect(shadowSpread()).toBeGreaterThanOrEqual(
      outlineWidth() + outlineOffset() + 2,
    );
  });

  it("has two layers that contrast with each other", () => {
    // WCAG 1.4.11 non-text contrast. This is the property that makes the
    // ring surface-independent: whichever layer a background swallows, the
    // other still draws the shape against it.
    expect(contrastRatio(lightLayer(), darkLayer())).toBeGreaterThanOrEqual(3);
  });

  it.each(HEADER_BARS)(
    "shows its light layer on the %s at either photo extreme",
    (_name, selector) => {
      for (const photo of [BLACK, WHITE]) {
        expect(
          contrastRatio(lightLayer(), headerOver(photo, selector)),
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("shows its dark layer on the lightest the cards ever get", () => {
    expect(contrastRatio(darkLayer(), cardOver(WHITE))).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("shows its dark layer on the bare page over a white photo", () => {
    // Controls that sit on no panel at all still have to be ringed.
    expect(
      contrastRatio(darkLayer(), backgroundLayerOver(WHITE)),
    ).toBeGreaterThanOrEqual(3);
  });
});
