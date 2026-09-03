import { describe, expect, it } from "vitest";
import { RULES, declaration, label } from "./css-rules";

// The colour half of what font-tokens.test.ts does for typefaces (#565).
//
// The admin has exactly two semantic colours: the brown it uses for the one
// obvious next action, and the red it uses for the ones that destroy
// something. Each comes as a resting/hover pair.
//
// The red was tokenised in #457 precisely so it would live in one place. The
// brown was not, and it drifted the way an untokenised colour always does:
// `#6d3513` ended up written out in six stylesheets across both workspaces —
// twice with an alpha suffix — so changing the admin's primary colour was a
// grep-and-sweep rather than an edit, and text-contrast.test.ts could not
// resolve the brown through a token the way it already could the red.
//
// These tests pin the property that fixes that, and only that property: the
// hexes are spelled ONCE, in the admin :root, and every admin rule that
// wants one goes through `var()`. A literal creeping back in is a rule that
// the next change to the admin's palette will silently miss.
//
// Deliberately scoped to apps/admin. The public site spends the same brown
// at two other alphas (site-button, error-boundary) and the same pale fill
// in three more places; those are the surface-tint question tracked by #480,
// a different decision with a different set of consumers.
const ADMIN_ROOT = "apps/admin/src/admin.css";
const ADMIN_SOURCE = "apps/admin/src/";

/** The four semantic colours, and the one place each is allowed to appear. */
const TOKENS: Record<string, string> = {
  "--admin-primary": "#6d3513",
  "--admin-primary-hover": "#552a0f",
  "--admin-danger": "#a33327",
  "--admin-danger-hover": "#872a20",
};

const adminRules = RULES.filter((rule) => rule.file.startsWith(ADMIN_SOURCE));

const adminRoot = adminRules.find(
  (rule) => rule.file === ADMIN_ROOT && rule.selector === ":root",
);

/** Every admin rule except the :root that defines the tokens. */
const consumers = adminRules.filter((rule) => rule !== adminRoot);

describe("the admin's semantic colour tokens", () => {
  it("defines all four in the admin :root", () => {
    expect(adminRoot).toBeDefined();
    for (const [token, hex] of Object.entries(TOKENS)) {
      expect(declaration(adminRoot!.block, token)).toBe(hex);
    }
  });

  // Substring, not an exact-value match, so an alpha-suffixed literal
  // (`#6d3513b5`, which is how two of the six copies were written) is caught
  // as readily as a bare one. The stylesheet reader strips comments, so
  // naming a hex in a comment is not a failure.
  it.each(Object.entries(TOKENS))(
    "spells %s (%s) nowhere in the admin but that one definition",
    (_token, hex) => {
      const literals = consumers
        .filter((rule) => rule.block.toLowerCase().includes(hex))
        .map(label);
      expect(literals).toEqual([]);
    },
  );

  // An unused token is a colour nobody can see and nobody will maintain —
  // and, worse, one whose contrast the tests above go on vouching for.
  it("uses all four — an unused one would rot unnoticed", () => {
    const used = new Set(
      consumers.flatMap((rule) =>
        [...rule.block.matchAll(/var\(\s*(--admin-[\w-]+)\s*\)/g)].map(
          (match) => match[1],
        ),
      ),
    );
    expect(Object.keys(TOKENS).filter((token) => !used.has(token))).toEqual([]);
  });
});
