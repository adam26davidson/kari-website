import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

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
// The admin side reuses the same token on the same translucent backing
// (#354), and the file also pins foregrounds that must not be left to
// inheritance to come out legible (#347) and the keyboard focus ring, whose
// job is to read on every one of these surfaces at once (#501).

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
const adminCardCss = read("pages/admin/components/card/card.css");
const adminHaikuCss = read("pages/admin/admin-haiku-page/admin-haiku-page.css");
const adminItemListCss = read(
  "pages/admin/components/admin-item-list/admin-item-list.css",
);
const blogPostSummaryCss = read(
  "components/blog-post-summary/blog-post-summary.css",
);
const adminButtonCss = read(
  "pages/admin/components/admin-button/admin-button.css",
);

/**
 * The one colour in an admin declaration, following a `var(--token)` to the
 * admin `:root` (where the danger pair lives) rather than the site one. The
 * value may be a shorthand — `1px solid var(--admin-danger)`.
 */
function adminColor(value: string): Rgb {
  const token = value.match(/var\(\s*(--[\w-]+)\s*\)/);
  const resolved = token ? declaration(adminCss, ":root", token[1]) : value;
  return parseColor(
    resolved.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/i)?.[0] ?? resolved,
  );
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
    const bodyText = parseColor(
      declaration(haikuCss, ".haiku-list-line", "color"),
    );
    const card = cardOver(MID_GREY);
    expect(contrastRatio(mutedText(), card)).toBeLessThan(
      contrastRatio(bodyText, card),
    );
  });
});

// The admin panels are the same translucent grey over the same background
// photo as the public cards, so the same token — and the contrast argument
// above — applies to their secondary text (#354).
const ADMIN_SECONDARY_TEXT_RULES: ReadonlyArray<[string, string, string]> = [
  ["sidebar menu item", adminCss, ".admin-menu-item"],
  ["empty-result notice", adminItemListCss, ".admin-data-list-empty"],
  ["search match count", adminItemListCss, ".admin-data-list-count"],
  ["haiku list publisher", adminHaikuCss, ".admin-haiku-list-publisher"],
  // Only ever rendered on the admin other-works list (the public page
  // passes showPublished={false}), and the last piece of admin secondary
  // text still carrying a hex of its own: #666, which is 4.0:1 on the row
  // and the "Published" two visual reviews running named as hard to read.
  [
    "other-works published status",
    blogPostSummaryCss,
    ".blog-post-summary-status",
  ],
];

/** Every admin surface the rules above render their text on. */
const ADMIN_PANELS: ReadonlyArray<[string, string, string]> = [
  ["sidebar", adminCss, ".admin-menu"],
  ["empty-result notice", adminItemListCss, ".admin-data-list-empty"],
  ["search match count", adminItemListCss, ".admin-data-list-count"],
  ["list row", adminItemListCss, ".admin-data-list-item"],
  ["list header panel", adminItemListCss, ".admin-data-list-header"],
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

  // The tint is only half of it. At 80% the photograph still reads through,
  // and it is the small grey secondary line that loses — a publisher or a
  // date landing on blurred petals. The blur is what turns the backing into
  // a calm, even surface, so it is part of the contract rather than a
  // flourish one panel happens to have: the list rows shipped without it
  // while the sidebar, .card and .data-editor-content all had it (#307).
  it.each(ADMIN_PANELS)(
    "%s blurs the photo behind it instead of letting it read through",
    (_name, css, selector) => {
      expect(declaration(css, selector, "backdrop-filter")).toMatch(/blur\(/);
    },
  );
});

// Every admin section opens with an <h2> and one line saying what the page
// is for, both sitting on the pale translucent panel. The body's default
// colour is --light-text — correct over the background photo, invisible on
// that panel — so a section that leaves either to inheritance renders
// near-white on grey. That is not hypothetical: the home-page editor
// shipped exactly that way while its four siblings each re-declared a dark
// colour of their own. The colour therefore lives in ONE shared pair of
// classes and every admin heading has to wear them, so the next section
// added cannot re-acquire the bug by omission (#457).
const ADMIN_DIR = "pages/admin";

/** Every non-test `.tsx` under `src/pages/admin`, as `read()` paths. */
function adminComponents(dir: string): string[] {
  return readdirSync(`src/${dir}`, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return adminComponents(path);
    return entry.isFile() &&
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

/** Every `<h2 ...>` opening tag in the admin tree, with its file. */
const ADMIN_HEADINGS: ReadonlyArray<[string, string]> = adminComponents(
  ADMIN_DIR,
).flatMap((path) =>
  [...read(path).matchAll(/<h2[^>]*>/g)].map(
    ([tag]) => [path, tag] as [string, string],
  ),
);

/** The admin card as it actually renders over a given photo. */
const adminCardOver = (photo: Rgb): Rgb =>
  surfaceOver(photo, declaration(adminCardCss, ".card", "background-color"));

describe("the admin section headings", () => {
  it("finds the heading of every admin section", () => {
    // Home page, site background, image cleanup, what's on test. A drop
    // below that means the scan stopped seeing what it is meant to check.
    expect(ADMIN_HEADINGS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(ADMIN_HEADINGS)(
    "%s puts its heading in the shared class rather than inheriting a colour",
    (_path, tag) => {
      // Worn alongside a page's own class where one is needed (the editor
      // titles add a size), so this is a token check, not equality.
      const className = tag.match(/className="([^"]*)"/)?.[1] ?? "";
      expect(className.split(/\s+/)).toContain("admin-section-heading");
    },
  );

  it.each([[".admin-section-heading"], [".admin-section-explanation"]])(
    "%s stays legible on the card whatever photo is behind it",
    (selector) => {
      const color = resolveColor(declaration(adminCss, selector, "color"));
      for (const photo of [BLACK, MID_GREY, WHITE]) {
        expect(
          contrastRatio(color, adminCardOver(photo)),
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("keeps the explanation line secondary to the heading above it", () => {
    const card = adminCardOver(MID_GREY);
    const heading = resolveColor(
      declaration(adminCss, ".admin-section-heading", "color"),
    );
    const explanation = resolveColor(
      declaration(adminCss, ".admin-section-explanation", "color"),
    );
    expect(contrastRatio(explanation, card)).toBeLessThan(
      contrastRatio(heading, card),
    );
  });
});

// The glyph on an icon control is only legible because of the colour
// declared on the control. `color: inherit` made that lightness an accident
// of whichever ancestor last set a colour — one dark-text ancestor away from
// an invisible icon (#347). Since #457 the icon circles are the move arrows
// and nothing else, and they are outlined rather than filled, so the brown
// now has to carry the GLYPH and the RING against the button's own pale
// fill rather than sit behind a white glyph.
describe("the admin icon buttons", () => {
  const declared = (property: string) =>
    declaration(adminCss, ".admin-icon-button", property);

  it("declare their own foreground rather than inheriting one", () => {
    expect(declared("color")).not.toBe("inherit");
  });

  it("put a glyph on their fill that meets WCAG AA", () => {
    expect(
      contrastRatio(
        resolveColor(declared("color")),
        parseColor(declared("background-color")),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // The ring is the whole edge of the control — an outlined button with an
  // invisible border is not a button (WCAG 1.4.11 non-text contrast).
  it("draw a ring that reads as a shape on their own fill", () => {
    expect(
      contrastRatio(
        adminColor(declared("border")),
        parseColor(declared("background-color")),
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  // A bordered circle on a fixed 30/44px control has to be border-box, or
  // the ring grows it past the size it declares.
  it("size the circles so a ring cannot grow them", () => {
    expect(declared("box-sizing")).toBe("border-box");
  });

  // The quiet destructive button inverts the arrangement: red on the pale
  // fill rather than white on red. It is the one place the danger colour
  // has to carry TEXT contrast rather than just be a background, so its
  // legibility cannot be assumed from the filled variant's numbers. Since
  // #457 it is also every list row's Delete, not only the photography
  // editor's "Remove this image".
  it("keep the outlined destructive button legible on its own fill", () => {
    const OUTLINED = ".admin-button.danger-secondary";
    const outlined = (property: string) =>
      declaration(adminButtonCss, OUTLINED, property);
    const fill = parseColor(outlined("background-color"));

    expect(
      contrastRatio(adminColor(outlined("color")), fill),
    ).toBeGreaterThanOrEqual(4.5);
    // And its outline has to read as a shape (WCAG 1.4.11 non-text
    // contrast) — an invisible border is not a button.
    expect(
      contrastRatio(adminColor(outlined("border")), fill),
    ).toBeGreaterThanOrEqual(3);
  });

  // Not a WCAG rule — just "these must not read as the same button". Edit
  // and delete sat side by side in identical brown circles (#457); now each
  // carries its own word, and colour still separates them: edit is outlined
  // in the primary brown family, delete in the danger red. Spending LESS
  // red, never a different colour — the maintainer's call on this is
  // explicit, red is the right colour for delete.
  it("colours edit and delete apart as well as naming them", () => {
    const edit = declaration(adminButtonCss, ".admin-button.secondary", "border");
    const del = declaration(
      adminButtonCss,
      ".admin-button.danger-secondary",
      "border",
    );
    expect(del).toContain("--admin-danger");
    expect(edit).not.toContain("--admin-danger");
    expect(adminColor(edit)).not.toEqual(adminColor(del));
    // Edit's outline is the same brown the icon circles beside it wear, so
    // the row reads as one family with one exception.
    expect(adminColor(edit)).toEqual(adminColor(declared("border")));
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

  /** The one colour in a shorthand value. */
  const colorIn = (value: string): Rgb =>
    parseColor(
      value.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)|\b(?:white|black)\b/i)?.[0] ??
        value,
    );

  const lightLayer = () => colorIn(outline());
  const darkLayer = () => colorIn(boxShadow());

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
