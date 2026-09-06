import { describe, expect, it } from "vitest";
import { RULES, declaration, label } from "./css-rules";

// The header bar's title is the page's <h1> (#504) — the only level-1
// heading either app has, since the public pages carry none of their own and
// the admin pages open at level 2.
//
// Promoting it from a <div> handed it three browser defaults a <div> never
// had: `font-size: 2em`, `font-weight: bold` and `margin: 0.67em 0`. The
// bar is a flex row of fixed height, so the margin is the one that bites —
// it grows the bar on every page, and nothing in the test suite lays
// anything out to notice. The stylesheet therefore has to state all three
// for every class the title can wear, and `margin-left: 20px` is NOT
// stating the margin: the shorthand is what zeroes the top and bottom the
// UA sheet supplies.
//
// The classes are checked as a set rather than rule by rule because two of
// them are only ever reached through a descendant rule (`.header
// .header-title-mobile`), so the class's own rule is not where every
// declaration lives.

/** The classes the header title wears, one per bar and viewport (#482). */
const TITLE_CLASSES = [
  ".header-title",
  ".admin-header-title",
  ".header-title-mobile",
];

/** The <h1> defaults a rule must override for the bar to look unchanged. */
const NEUTRALIZED = ["margin", "font-size", "font-weight"];

/** Rules whose selector targets `className`, at any specificity. */
const rulesFor = (className: string) =>
  RULES.filter((rule) =>
    rule.selector.split(",").some((part) => part.trim().endsWith(className)),
  );

describe("the header title's heading chrome", () => {
  it.each(
    TITLE_CLASSES.flatMap((className) =>
      NEUTRALIZED.map((property): [string, string] => [className, property]),
    ),
  )("%s states its own %s rather than the <h1> default", (
    className,
    property,
  ) => {
    const declaring = rulesFor(className)
      .filter((rule) => declaration(rule.block, property) !== undefined)
      .map(label);
    expect(declaring).not.toHaveLength(0);
  });
});
