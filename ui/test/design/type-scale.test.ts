import { describe, expect, it } from "vitest";
import {
  RULES,
  declaration,
  declaring,
  indexRule,
  label,
} from "./css-rules";

// The weight half of the type scale (#356).
//
// `body` used to declare `font-weight: 300`. In Noto Serif JP at 14-16px
// those stems render as hairlines, so small text read far lighter than its
// nominal colour — which is what actually made the attribution lines in
// #343 look washed out even though the colour already cleared AA. That was
// fixed four rules at a time; anything added afterwards inherited the same
// hairline again, and text that never declares a font-size at all (the home
// blurb, the injected blog HTML, `.loading`) could not have been protected
// by any rule phrased in terms of small text.
//
// So the default is 400 and the light weight is an explicit opt-in through
// the `--display-weight` token, permitted only where the same rule declares
// a font-size of at least 18px. These tests pin all three halves of that:
// the default, the opt-in's spelling, and the size floor it is allowed at.

// The stylesheet reader these assertions run on is shared with the other
// CSS-invariant tests; see ./css-rules.
const DISPLAY_TOKEN = "--display-weight";

/** The smallest weight the display token is allowed to be spent on. */
const DISPLAY_SIZE_FLOOR_PX = 18;

/**
 * Whether a weight value is at or above regular. `bold`/`bolder` are, the
 * bare numbers speak for themselves, and `lighter` is by definition not.
 */
function isRegularOrHeavier(value: string): boolean {
  if (value === "normal" || value === "bold" || value === "bolder") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 400;
}

/**
 * The smallest px value a `font-size` names, or undefined if it names none.
 * A fluid size (clamp/min/max) is judged on its smallest px value — that is
 * the width at which its stems are thinnest.
 */
function smallestPx(size: string | undefined): number | undefined {
  const pxValues = size
    ?.match(/([\d.]+)px/g)
    ?.map((px) => Number.parseFloat(px));
  return pxValues?.length ? Math.min(...pxValues) : undefined;
}

/** A selector's comma-separated parts, with whitespace normalized. */
const selectorParts = (selector: string): string[] =>
  selector
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);

/** The selector parts some rule spends the display weight on. */
const SPENT_ON = new Set(
  RULES.filter((rule) =>
    declaration(rule.block, "font-weight")?.includes(DISPLAY_TOKEN),
  ).flatMap((rule) => selectorParts(rule.selector)),
);

describe("the weight axis of the type scale", () => {
  it("leaves body text at regular weight, not the hairline 300", () => {
    const weight = declaration(indexRule("body").block, "font-weight");
    expect(weight).toBeDefined();
    expect(isRegularOrHeavier(weight as string)).toBe(true);
  });

  it.each(declaring("font-weight"))(
    "%s reaches any light weight through the display token",
    (_label, value) => {
      // Either at/above regular, or the documented opt-in spelled exactly.
      const allowed =
        isRegularOrHeavier(value) || value === `var(${DISPLAY_TOKEN})`;
      expect(allowed).toBe(true);
    },
  );

  it.each(
    RULES.filter((rule) =>
      declaration(rule.block, "font-weight")?.includes(DISPLAY_TOKEN),
    ).map((rule): [string, string] => [label(rule), rule.block]),
  )(
    "%s spends the display weight on text of at least 18px",
    (_label, block) => {
      const smallest = smallestPx(declaration(block, "font-size"));
      expect(smallest).toBeDefined();
      expect(smallest as number).toBeGreaterThanOrEqual(DISPLAY_SIZE_FLOOR_PX);
    },
  );

  // The check above only sees the rule that spends the token, which is not
  // where this regresses. A media override resizes a selector without
  // re-declaring its weight, so `.admin-menu-item { font-size: 18px;
  // font-weight: var(--display-weight) }` plus `@media (max-width: 767.98px)
  // { .admin-menu-item { font-size: 16px } }` renders 16px hairline text on
  // every phone — the exact defect the floor exists to prevent, invisible to
  // a per-rule check because the rule doing the shrinking spends nothing.
  //
  // So every rule that sizes a selector some other rule spends the token on
  // is held to the same floor. A rule may go smaller, but only by declaring
  // a regular-or-heavier weight of its own, which puts the light stems this
  // floor protects out of play.
  it.each(
    RULES.filter(
      (rule) =>
        declaration(rule.block, "font-size") !== undefined &&
        !declaration(rule.block, "font-weight")?.includes(DISPLAY_TOKEN) &&
        selectorParts(rule.selector).some((part) => SPENT_ON.has(part)),
    ).map((rule): [string, string] => [label(rule), rule.block]),
  )(
    "%s resizes display-weight text without dropping it below 18px",
    (_label, block) => {
      const weight = declaration(block, "font-weight");
      // Opted out of the light weight; any size is legible at 400.
      if (weight !== undefined && isRegularOrHeavier(weight)) return;
      const smallest = smallestPx(declaration(block, "font-size"));
      expect(smallest).toBeDefined();
      expect(smallest as number).toBeGreaterThanOrEqual(DISPLAY_SIZE_FLOOR_PX);
    },
  );

  it("keeps the display token itself light — it has no other purpose", () => {
    const value = Number(declaration(indexRule(":root").block, DISPLAY_TOKEN));
    expect(value).toBeGreaterThanOrEqual(200);
    expect(value).toBeLessThan(400);
  });
});
