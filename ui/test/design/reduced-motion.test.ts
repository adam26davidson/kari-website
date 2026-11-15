import { describe, expect, it } from "vitest";
import { RULES, declarations, label } from "./css-rules";

// Entrance animations honour `prefers-reduced-motion` (#1058).
//
// The public site's `.fade-in` (home card children, the data-list card)
// used to hide its element with a static `opacity: 0` and let the
// animation bring it back — so a visitor who had asked their OS to reduce
// motion still got the fade, and the home blurb (1s delay) stayed
// invisible for nearly two seconds.
//
// The fix is progressive enhancement: the hidden starting state AND the
// animation are both declared only inside
// `@media (prefers-reduced-motion: no-preference)`. Under `reduce` (or in
// a browser that does not know the feature) the element is simply there.
// Gating only the animation would not be enough — the static
// `opacity: 0` would then hide the content for good.
//
// Stylesheet assertions, like the rest of test/design: jsdom evaluates no
// media queries and runs no animations.

const NO_PREFERENCE = "@media (prefers-reduced-motion: no-preference)";

/** `animation` and its `animation-name` longhand — what starts one. */
const STARTS_ANIMATION = /^animation(-name)?$/;

describe("reduced motion", () => {
  it("declares every animation only for visitors with no preference", () => {
    const ungated = RULES.filter(
      (rule) =>
        declarations(rule.block).some((decl) =>
          STARTS_ANIMATION.test(decl.property),
        ) && !rule.atRules.includes(NO_PREFERENCE),
    ).map(label);

    expect(ungated).toEqual([]);
  });

  it("never hides .fade-in content outside that gate", () => {
    const hiding = RULES.filter(
      (rule) =>
        /(^|[\s,])\.fade-in(?![\w-])/.test(rule.selector) &&
        !rule.atRules.includes(NO_PREFERENCE) &&
        declarations(rule.block).some(
          (decl) => decl.property === "opacity" && decl.value === "0",
        ),
    ).map(label);

    expect(hiding).toEqual([]);
  });

  it("still fades .fade-in in for visitors with no preference", () => {
    const gated = RULES.filter(
      (rule) =>
        rule.selector === ".fade-in" && rule.atRules.includes(NO_PREFERENCE),
    );

    expect(gated.map(label)).toHaveLength(1);
    const decls = declarations(gated[0].block);
    expect(decls).toContainEqual({ property: "opacity", value: "0" });
    expect(
      decls.find((decl) => decl.property === "animation")?.value,
    ).toMatch(/^fadeIn\b/);
  });
});
