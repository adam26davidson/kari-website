import { describe, expect, it } from "vitest";
import { RULES, declaration, declarations, label } from "./css-rules";

// One scroll container per app, below the header (#581).
//
// The shell used to stack four nested boxes that all declared `overflow-y:
// auto` — `.content`, `.content-page`, `.data-list-container`,
// `.admin-data-list-container` — of which exactly one ever scrolled. Each
// layer's `overflow-y` zeroed its own flex automatic minimum size, so each
// shrank to fit its parent and the INNERMOST one ended up with the
// scrollable overflow. The outer three were inert, and the arrangement is
// what made #558's stranded header so hard to reason about: "which box is
// scrolling" had no answer you could read off a stylesheet.
//
// After the consolidation exactly two boxes scroll, one per app:
//
//   * `.content` (packages/shared/src/styles/app.css) — the public site's
//     scroller. It is a child of `.whole-page`, which is exactly as tall as
//     the visible viewport (#558), so it is the box that turns a tall page
//     into a scrollbar. Inert on the admin side by construction:
//     `.admin-container` is pinned to `height: 100%`, so nothing inside it
//     can make `.content` overflow.
//   * `.admin-content` (apps/admin/src/admin.css) — the admin's scroller,
//     `height: 100%` + `overflow-y: auto`, which #794 made the single
//     scroller for the editor cards.
//
// Everything between those and the content GROWS instead: a page wrapper
// with no `overflow` and no height cap contributes its full height to its
// ancestor's scrollable overflow region, and the one scroller reaches all
// of it.
//
// These are stylesheet assertions, not rendered ones: jsdom lays nothing
// out, so a computed `overflow-y` is not observable from a mounted
// component, and the e2e suite (visitor.spec.ts, "the shell is the only
// thing that scrolls") covers what a real browser can see. What this file
// pins is the invariant itself — a ratchet, so the next nested scroller has
// to be argued for here rather than added quietly.

/** `overflow`, `overflow-x` and `overflow-y` — the shorthand and both axes. */
const OVERFLOW = /^overflow(-[xy])?$/;

/**
 * The values that MAKE a scroll container. `hidden` and `clip` do not: they
 * are used all over the site to trim a shadow or ellipsize a name, and
 * neither can strand content behind a scrollbar that isn't there.
 */
const SCROLLING = new Set(["auto", "scroll", "overlay"]);

/** Every rule declaring a scrolling overflow, as `file { selector }` labels. */
const SCROLLERS = RULES.flatMap((rule) =>
  declarations(rule.block).some(
    (decl) => OVERFLOW.test(decl.property) && SCROLLING.has(decl.value),
  )
    ? [label(rule)]
    : [],
);

/**
 * The wrappers that sit between a scroller and the page content. Each is a
 * flex item of `.content`, which is a ROW flex container: main axis
 * horizontal, cross axis vertical. Both of those facts bite, which is why
 * this pattern is four declarations rather than "just delete the overflow".
 */
const GROWERS = [
  {
    file: "apps/public/src/components/content-page/content-page.css",
    selector: ".content-page",
  },
  {
    file: "apps/public/src/pages/home-page/home-page.css",
    selector: ".home-page",
  },
] as const;

const growerRule = ({ file, selector }: (typeof GROWERS)[number]) => {
  const rule = RULES.find(
    (candidate) =>
      candidate.file === file &&
      candidate.selector === selector &&
      candidate.atRules.length === 0,
  );
  if (!rule) throw new Error(`no unconditional ${selector} rule in ${file}`);
  return rule;
};

describe("scroll containers", () => {
  it("has exactly one per app, and they are the two shells", () => {
    // Sorted so the failure message is stable and reads as a list of every
    // box that can scroll on the whole site.
    expect(SCROLLERS.sort()).toEqual([
      "apps/admin/src/admin.css { .admin-content }",
      "packages/shared/src/styles/app.css { .content }",
    ]);
  });

  describe.each(GROWERS)("$selector", (grower) => {
    it("fills the shell without being capped by it", () => {
      const block = growerRule(grower).block;
      // `min-height`, never `height`: the wrapper must reach the bottom of
      // the shell when the page is short (so `justify-content` has the
      // whole column to distribute in) and grow PAST it when the page is
      // tall. `height: 100%` does the first and forbids the second, which
      // is what made the inner box the scroller.
      expect(declaration(block, "min-height")).toBe("100%");
      expect(declaration(block, "height")).toBeUndefined();
      expect(declaration(block, "max-height")).toBeUndefined();
    });

    it("is not itself a scroll container", () => {
      const overflow = declarations(growerRule(grower).block).filter((decl) =>
        OVERFLOW.test(decl.property),
      );
      expect(overflow).toEqual([]);
    });

    it("opts out of the shell's cross-axis stretch", () => {
      // `.content` is `align-items: stretch` (its default), which sets a
      // height-auto item's used height to the flex line's — i.e. back to
      // the shell's height, undoing the `min-height` above and resurrecting
      // the bug in its nastiest form: `.content-page`'s `space-evenly`
      // (and `.home-page`'s `center`) fall back to CENTRE alignment under
      // negative free space, so the overflow splits across BOTH ends and
      // the top of the page sits above the scroller's origin, where no
      // amount of scrolling can reach it.
      //
      // `align-self: flex-start` is the opt-out. It cannot be done by
      // changing `.content`'s `align-items` instead: `.route-loading` and
      // `.mobile-menu` are its other children and both rely on the stretch.
      expect(declaration(growerRule(grower).block, "align-self")).toBe(
        "flex-start",
      );
    });

    it("may shrink below its content's intrinsic width", () => {
      // The other half of the automatic-minimum-size story. `.content`'s
      // MAIN axis is horizontal, so dropping `overflow-y` restores
      // `min-width: auto` on these items — and a wrapper that refuses to
      // shrink below its widest child's min-content width pushes the whole
      // page sideways at 390px.
      expect(declaration(growerRule(grower).block, "min-width")).toBe("0");
    });
  });
});
