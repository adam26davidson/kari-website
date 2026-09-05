import { describe, expect, it } from "vitest";
import { RULES, declaration, label } from "./css-rules";

// The colour half of what font-tokens.test.ts does for typefaces (#565,
// widened to the whole site in #480).
//
// The site has a small fixed palette: two foregrounds for the dark surfaces
// and two for the pale ones, the greys and creams the panels and cards are
// tinted with, the brown it spends on the one obvious next action, the green
// the header bar wears, and the red reserved for the controls that destroy
// something.
//
// Every one of those used to be spelled where it was used, and they drifted
// the way untokenised colours always do. `#6d3513` reached six stylesheets —
// twice with an alpha suffix — before #565 pulled it into the admin :root;
// `rgba(226, 226, 226, 0.8)` reached eight, `#f2efe9` five and `#181818`
// twenty. Worse than the churn, each copy re-stated a CONTRAST argument that
// only holds for one particular value: every one of these panels floats over
// an admin-chosen background photo, so each has to carry its foreground on
// its own, and text-contrast.test.ts had one place to check a floor that was
// declared in eight.
//
// These tests pin the property that fixes that, and only that property: each
// colour is spelled ONCE, and every rule that wants one goes through `var()`.
// A literal creeping back in is a rule that the next change to the palette
// will silently miss — and one the contrast floors will go on vouching for
// while it quietly says something else.

/** The shared stylesheet both apps import, and the admin's own. */
const SHARED_ROOT = "packages/shared/src/styles/index.css";
const ADMIN_ROOT = "apps/admin/src/admin.css";

/**
 * Every semantic colour, the `:root` that owns it, and the one hex it is
 * allowed to be spelled as. The shared root owns everything both apps can
 * see; the admin root owns only what is genuinely the admin's alone.
 */
const TOKENS: ReadonlyArray<[string, string, string]> = [
  // Foregrounds. Two for the dark surfaces (the page over the photo, the
  // header bar), two for the pale ones (the panels and cards).
  [SHARED_ROOT, "--light-text", "#e6e6e6"],
  [SHARED_ROOT, "--muted-light-text", "#c9c9c9"],
  [SHARED_ROOT, "--dark-text", "#181818"],
  [SHARED_ROOT, "--muted-text", "#3d3d3d"],
  // Surfaces.
  [SHARED_ROOT, "--panel-surface", "#e2e2e2"],
  [SHARED_ROOT, "--card-surface", "#f2efe9"],
  [SHARED_ROOT, "--header-surface", "#1c3100"],
  // The one brown, shared: the public share/download buttons and the error
  // notice's Reload spend it as surely as the admin's Save does.
  [SHARED_ROOT, "--primary", "#6d3513"],
  [SHARED_ROOT, "--primary-hover", "#552a0f"],
  // The one red. Admin-only on purpose — the public site has no control
  // that destroys anything, so a destructive colour there would be a
  // colour with nothing to say.
  [ADMIN_ROOT, "--admin-danger", "#a33327"],
  [ADMIN_ROOT, "--admin-danger-hover", "#872a20"],
];

/**
 * The admin's semantic names for shared colours. These stay as names —
 * "the admin's primary" is what the rules that spend them mean, and a
 * future admin palette can re-point them without touching the public
 * site — but they alias rather than re-declare, or the hex would be back
 * to living in two places.
 */
const ADMIN_ALIASES: ReadonlyArray<[string, string]> = [
  ["--admin-primary", "var(--primary)"],
  ["--admin-primary-hover", "var(--primary-hover)"],
];

/**
 * Spellings of a tokenised colour that a hex search cannot see. Each is how
 * one of the tokens above was actually written before it had a name, so
 * each is the exact shape of the regression this file exists to catch.
 */
const BANNED_LITERALS: ReadonlyArray<[string, string]> = [
  ["the panel grey, as rgb", "rgba(226, 226, 226"],
  ["the header green, as rgb", "rgba(28, 49, 0"],
];

const roots = new Map(
  [SHARED_ROOT, ADMIN_ROOT].map((file) => [
    file,
    RULES.find((rule) => rule.file === file && rule.selector === ":root"),
  ]),
);

/** Every rule in every workspace except the two that define the tokens. */
const consumers = RULES.filter(
  (rule) => !(rule.selector === ":root" && roots.has(rule.file)),
);

describe("the site's semantic colour tokens", () => {
  it.each(TOKENS)("%s declares %s as %s", (file, token, hex) => {
    expect(roots.get(file)).toBeDefined();
    expect(declaration(roots.get(file)!.block, token)).toBe(hex);
  });

  // Substring, not an exact-value match, so an alpha-suffixed literal
  // (`#6d3513b5`, which is how two of the six copies of the brown were
  // written) is caught as readily as a bare one. The stylesheet reader
  // strips comments, so naming a hex in a comment is not a failure.
  it.each(TOKENS)(
    "spells %#: %s (%s) nowhere but that one definition",
    (_file, _token, hex) => {
      const literals = consumers
        .filter((rule) => rule.block.toLowerCase().includes(hex))
        .map(label);
      expect(literals).toEqual([]);
    },
  );

  it.each(BANNED_LITERALS)("no rule writes %s out longhand", (_name, text) => {
    const literals = RULES.filter((rule) =>
      rule.block.toLowerCase().includes(text),
    ).map(label);
    expect(literals).toEqual([]);
  });

  it.each(ADMIN_ALIASES)(
    "%s aliases the shared token rather than repeating its hex",
    (token, aliased) => {
      expect(declaration(roots.get(ADMIN_ROOT)!.block, token)).toBe(aliased);
    },
  );

  // An unused token is a colour nobody can see and nobody will maintain —
  // and, worse, one whose contrast the tests in text-contrast.test.ts go on
  // vouching for.
  it("uses every token — an unused one would rot unnoticed", () => {
    const used = new Set(
      RULES.flatMap((rule) =>
        [...rule.block.matchAll(/var\(\s*(--[\w-]+)/g)].map(
          (match) => match[1],
        ),
      ),
    );
    const declared = [
      ...TOKENS.map(([, token]) => token),
      ...ADMIN_ALIASES.map(([token]) => token),
    ];
    expect(declared.filter((token) => !used.has(token))).toEqual([]);
  });
});
