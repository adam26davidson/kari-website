import { describe, expect, it } from "vitest";
import { RULES, declaration, label } from "./css-rules";

// The hamburger carries padding so the site-wide :focus-visible ring has
// room around the glyph rather than tracing it (#545), and so the only
// control on a phone header clears the 24px WCAG 2.5.8 target minimum.
//
// Padding on a flex item is not free: it grows the item's box, which moves
// the glyph inside it AND every sibling after it along the bar. The bar is
// one flex row, so the title that follows slides right by the padding and —
// because the title is `flex: 1` against a fixed-width user block — loses
// exactly that much of the gap before the admin bar's user section, a gap
// the 390px rebalance in header.css had just been widened to create.
//
// The rule therefore pays for its own padding out of its margins: the left
// margin drops by the padding so the glyph keeps its 20px offset from the
// viewport edge, and the right margin goes NEGATIVE by the same amount so
// the button's effective footprint is the glyph's again. Nothing downstream
// moves. Both halves are easy to half-do — the left one is obvious once the
// glyph visibly shifts, the right one is invisible without measuring — so
// both are pinned here.
//
// Asserted on what the stylesheet declares, not on a computed layout: jsdom
// lays nothing out, and the arithmetic is the claim worth keeping.

/** The glyph's distance from the viewport edge, in px, before #545. */
const GLYPH_OFFSET = 20;

/**
 * A 1-to-4-value box shorthand (`6px`, `6px 4px`, `1px 2px 3px 4px`) as
 * top/right/bottom/left, filling omitted sides the way CSS does.
 */
function sides(value: string): [string, string, string, string] {
  const parts = value.split(/\s+/).filter(Boolean);
  const [top, right = top, bottom = top, left = right] = parts;
  return [top, right, bottom, left];
}

/** A px-valued declaration as a number. Throws on anything else. */
function px(value: string | undefined, what: string): number {
  const match = value?.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!match) throw new Error(`${what} is \`${value}\`, expected a px length`);
  return Number(match[1]);
}

const menuButton = RULES.filter(
  (rule) => rule.selector === ".header-menu-button",
);

describe("the header's hamburger button", () => {
  it("is declared exactly once, unconditionally", () => {
    expect(menuButton.map(label)).toHaveLength(1);
    expect(menuButton[0].atRules).toEqual([]);
  });

  it("pays for its focus-ring padding out of its own margins", () => {
    const { block } = menuButton[0];
    const padding = sides(declaration(block, "padding") ?? "0px");
    const [, right, , left] = padding.map((side, index) =>
      px(side, `padding side ${index}`),
    );
    // Defaulted rather than required: an undeclared margin IS 0px, and the
    // arithmetic below is a better failure message than "you didn't declare
    // margin-right" — 0px is exactly the value that used to be wrong.
    const marginLeft = px(
      declaration(block, "margin-left") ?? "0px",
      "margin-left",
    );
    const marginRight = px(
      declaration(block, "margin-right") ?? "0px",
      "margin-right",
    );

    // The glyph still starts where it always did...
    expect(marginLeft + left).toBe(GLYPH_OFFSET);
    // ...and the button takes up no more room than the glyph alone, so the
    // title beside it does not move.
    expect(marginRight + right).toBe(0);
  });
});
