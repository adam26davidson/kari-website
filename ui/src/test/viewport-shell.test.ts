import { describe, expect, it } from "vitest";
import { RULES, declarations, indexRule, label } from "./css-rules";

// The mobile double-scroll bug (#558).
//
// The shell used to be sized `height: 100vh`. On phones `vh` is the LARGE
// viewport height — the height the page would have with the URL bar and
// toolbars retracted — not the height actually visible while they are
// shown. So the shell was reliably taller than the visible area, which made
// the DOCUMENT a scroll container on top of the app's own inner one.
//
// The header is a normal-flow sibling of that inner scroller, so a gesture
// that moved the document carried the header (nav, mobile-menu button) off
// the top of the screen, and the inner scroller then swallowed the gesture
// that would have brought it back. Navigation became unreachable without a
// reload.
//
// Two declarations close that off, and these tests pin both:
//
//   * `100dvh` — the DYNAMIC viewport height, which tracks the browser
//     chrome as it retracts, so the shell never exceeds what is visible.
//     Each site keeps its `100vh` line first as a fallback for browsers
//     without `dvh` (Safari <15.4, Chrome <108), where the later
//     declaration is dropped as invalid and today's behaviour remains.
//     Order is therefore load-bearing and asserted.
//   * `overflow: hidden` on `body` — body overflow propagates to the
//     viewport when `html` declares none, so the document is not a scroll
//     container at all and no future overflow can resurrect the bug. It is
//     wrapped in `@supports (height: 100dvh)` because it only makes sense
//     alongside the correction above: a browser that drops `100dvh` keeps a
//     shell taller than the visible area, and taking the document's scroll
//     away there would strand the bottom `100vh - visible` strip of the
//     page off-screen for good — worse than the bug being fixed. Gated, the
//     fallback really is today's behaviour, and that gate is asserted.
//
// jsdom lays nothing out and has no browser chrome to retract, so none of
// this is observable from a rendered component; the stylesheet is the only
// place the invariant exists. The e2e suite covers the half that a headless
// browser CAN see (the document never scrolls); this covers the unit itself.

/**
 * A length in viewport-height units whose behaviour is the large viewport:
 * a digit immediately before `vh`, which `100dvh` / `100svh` / `100lvh` do
 * not match (a letter sits there instead).
 */
const BARE_VH = /\dvh\b/;

/** The same value with every bare `vh` length switched to `dvh`. */
const toDvh = (value: string) => value.replace(/(\d)vh\b/g, "$1dvh");

/**
 * The feature query the shell's `overflow: hidden` hangs off: exactly the
 * support the `100dvh` line needs, so the two halves of the fix can never
 * come apart.
 */
const SHELL_GATE = "@supports (height: 100dvh)";

interface Site {
  label: string;
  paired: boolean;
}

/**
 * Every bare-`vh` declaration in every stylesheet under src/, paired with
 * whether a later declaration in the SAME block restates the same property
 * in `dvh`. Later wins wherever `dvh` is understood, so this is both the
 * "use the dynamic unit" rule and the "keep the fallback first" rule.
 */
const VH_SITES: Site[] = RULES.flatMap((rule) => {
  const declared = declarations(rule.block);
  return declared.flatMap((decl, index) => {
    if (!BARE_VH.test(decl.value)) return [];
    const wanted = toDvh(decl.value);
    return [
      {
        label: `${label(rule)} ${decl.property}: ${decl.value}`,
        paired: declared
          .slice(index + 1)
          .some(
            (later) =>
              later.property === decl.property && later.value === wanted,
          ),
      },
    ];
  });
});

describe("the viewport shell", () => {
  it.each(["body", ".whole-page"])(
    "sizes %s by the dynamic viewport height, not the large one",
    (selector) => {
      const heights = declarations(indexRule(selector).block)
        .filter((decl) => decl.property === "height")
        .map((decl) => decl.value);
      // The last height declaration is the one that applies wherever the
      // unit is supported, and it must be the dynamic one.
      expect(heights.at(-1)).toBe("100dvh");
    },
  );

  it("keeps the document out of the scrolling wherever dvh applies", () => {
    const gated = RULES.filter(
      (rule) =>
        rule.file === "src/index.css" &&
        rule.selector === "body" &&
        rule.atRules.includes(SHELL_GATE),
    );
    const overflow = gated
      .flatMap((rule) => declarations(rule.block))
      .filter((decl) => decl.property === "overflow");
    // `hidden`, not `clip`: a `clip` box has no scrollable overflow region,
    // which would blind e2e/screenshots.mjs's horizontal-overflow assertion
    // (it reads document.documentElement.scrollWidth). And not `auto`,
    // which is what a scroll container is.
    expect(overflow.map((decl) => decl.value)).toEqual(["hidden"]);
  });

  it("leaves the document scrolling where the dvh correction is dropped", () => {
    // Unconditionally: `body`'s own rule must not take the scroll away.
    // Without `dvh` the shell is still `100vh` — taller than the visible
    // viewport while browser chrome is shown — and the document scroll is
    // the ONLY way to reach its bottom strip. Scrolling the inner scroller
    // moves content inside an off-screen box and never retracts the chrome,
    // so an ungated `overflow: hidden` clips that strip permanently on e.g.
    // iOS 15.0-15.3 Safari or Chrome <=107.
    const overflow = declarations(indexRule("body").block).filter(
      (decl) => decl.property === "overflow",
    );
    expect(overflow).toEqual([]);
  });

  it("gives every vh length a dvh line after it", () => {
    // Named individually so a failure says which declaration regressed.
    const unpaired = VH_SITES.filter((site) => !site.paired).map(
      (site) => site.label,
    );
    expect(unpaired).toEqual([]);
  });
});
