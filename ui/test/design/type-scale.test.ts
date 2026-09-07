import { describe, expect, it } from "vitest";
import {
  RULES,
  declaration,
  declarations,
  declaring,
  indexRule,
  label,
} from "./css-rules";

// The type scale has two axes, one describe block each below: the weight
// axis (#356) and the size axis (#546).

// ---------------------------------------------------------------------------
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
 * The size axis's steps, as `token: value`. Named after Tailwind's scale so
 * the vocabulary survives the admin's shadcn migration (#592). Asserted
 * against `:root` below, and used here to read a `var(--text-*)` size back
 * as px — without which the weight floor stops seeing the sizes it guards
 * the moment a rule spending `--display-weight` is put on a step.
 */
const STEPS: Record<string, string> = {
  "--text-xs": "12px",
  "--text-sm": "14px",
  "--text-base": "16px",
  "--text-lg": "18px",
  "--text-xl": "20px",
  "--text-2xl": "25px",
};

/** A `font-size` with every step token replaced by the px it stands for. */
const resolveSteps = (size: string): string =>
  size.replace(
    /var\((--text-[\w-]+)\)/g,
    (whole, token: string) => STEPS[token] ?? whole,
  );

/**
 * The smallest px value a `font-size` names, or undefined if it names none.
 * A fluid size (clamp/min/max) is judged on its smallest px value — that is
 * the width at which its stems are thinnest.
 */
function smallestPx(size: string | undefined): number | undefined {
  const pxValues = size
    ? resolveSteps(size)
        .match(/([\d.]+)px/g)
        ?.map((px) => Number.parseFloat(px))
    : undefined;
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

// ---------------------------------------------------------------------------
// The size half of the type scale (#546).
//
// #356 documented the weight axis and left the size axis ad hoc: every rule
// picked its own px number, so the site accumulated 12/13/14/15/16/17/18/20/
// 22/25px plus two rem values with nothing recording which of those were
// meant to be the same size as each other. A scale is only a scale if the
// set of steps is closed, so these tests close it: the steps live in `:root`
// as `--text-*` tokens (mirroring `--display-weight`), and every rule
// reaches a size through one of them.
//
// Two documented exceptions, both narrow and both pinned by an exact-match
// allowlist rather than a loophole:
//
//  - The header's two fluid sizes stay literal `clamp()`s. Their endpoints
//    were tuned against the 768-948px overflow band (#221); snapping them to
//    steps would move that tuning for no gain, since a clamp is not a step
//    in any case.
//  - The admin app's literals are FROZEN, not migrated. The shadcn migration
//    (#592, per-page #233-238, legacy-CSS removal #240) replaces admin CSS
//    wholesale, so tokenizing ~40 declarations now is churn destined for
//    deletion. Pinning the existing set shrink-only still stops NEW ad-hoc
//    sizes landing there meanwhile: a new admin rule must use a step, and
//    every value dropped from admin CSS should be dropped from this set too.

/** Stylesheets under this directory are the admin app's. */
const ADMIN_DIR = "apps/admin/";

/**
 * The two header sizes allowed to stay fluid literals, spelled exactly as
 * the stylesheet spells them — an exact match, so re-tuning either one is a
 * deliberate edit here rather than something a regex waves through.
 */
const FLUID_SIZES = new Set([
  "clamp(30px, 3.6vw, 40px)",
  "clamp(17px, 2.2vw, 20px)",
]);

/**
 * The literal sizes the admin app declared when the scale was introduced.
 * Frozen: nothing may be added, and entries should go as the shadcn
 * migration deletes the rules that use them.
 */
const FROZEN_ADMIN_SIZES = new Set([
  "12px",
  "13px",
  "14px",
  "15px",
  "16px",
  "17px",
  "18px",
  "20px",
  "22px",
  "0.85rem",
  "0.9rem",
]);

/** Whether a value is exactly one step token, spelled as a `var()`. */
const isStep = (value: string): boolean =>
  Object.keys(STEPS).some((token) => value === `var(${token})`);

/** Every `font-size` declared inside (or outside) the admin app. */
const sizesDeclared = (inAdmin: boolean): Array<[string, string]> =>
  RULES.flatMap((rule) => {
    if (rule.file.startsWith(ADMIN_DIR) !== inAdmin) return [];
    const value = declaration(rule.block, "font-size");
    return value ? [[label(rule), value] satisfies [string, string]] : [];
  });

describe("the size axis of the type scale", () => {
  it("declares exactly the documented steps, and no others", () => {
    const declared = Object.fromEntries(
      declarations(indexRule(":root").block)
        .filter(({ property }) => property.startsWith("--text-"))
        .map(({ property, value }) => [property, value]),
    );
    // A full-set compare in both directions: an undocumented seventh step
    // fails here just as a missing one does.
    expect(declared).toEqual(STEPS);
  });

  it.each(sizesDeclared(false))(
    "%s sizes public text with a step of the scale",
    (_label, value) => {
      expect(isStep(value) || FLUID_SIZES.has(value)).toBe(true);
    },
  );

  it.each(sizesDeclared(true))(
    "%s sizes admin text with a step, the prose token, or a frozen literal",
    (_label, value) => {
      const allowed =
        isStep(value) ||
        value === "var(--admin-prose-size)" ||
        FROZEN_ADMIN_SIZES.has(value);
      expect(allowed).toBe(true);
    },
  );

  it("keeps the frozen admin set shrinking, never stale", () => {
    // "Frozen" has to mean shrink-only to be worth anything: an entry left
    // behind after the rule using it is deleted quietly re-opens that size
    // for the next admin rule that wants it. So the set may only list sizes
    // the admin app still declares, and the shadcn migration prunes it as
    // it goes.
    const declared = new Set(sizesDeclared(true).map(([, value]) => value));
    const stale = [...FROZEN_ADMIN_SIZES].filter((size) => !declared.has(size));
    expect(stale).toEqual([]);
  });

  it("spends every step on something", () => {
    // A step nothing uses is a step nobody chose; it would drift out of the
    // set the rest of the site is actually built from.
    const used = new Set(
      sizesDeclared(false)
        .concat(sizesDeclared(true))
        .map(([, value]) => value),
    );
    const unused = Object.keys(STEPS).filter(
      (token) => !used.has(`var(${token})`),
    );
    expect(unused).toEqual([]);
  });
});
