import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every non-test source file under `dir`, as ui-relative paths. */
function sourceFiles(dir: string): string[] {
  return readdirSync(`${UI_ROOT}${dir}`, { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      if (!entry.isFile()) return [];
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [path]
        : [];
    },
  );
}

/**
 * The steps spent by markup rather than by a stylesheet, as the `var()`
 * spellings the CSS scan produces.
 *
 * The admin picks its sizes in Tailwind utilities, not in `font-size`
 * declarations, and the two meet at the very token `:root` declares:
 * `className="text-xs"` compiles to `font-size: var(--text-xs)`. So a
 * CSS-only reading of "is this step spent" is half the picture, and the
 * half it misses is the whole admin app — when #831/#836 deleted the last
 * hand-written `--text-xs` rule (the haiku/haiga compact variants), every
 * admin row was still spending that step and nothing else was.
 *
 * Comments are stripped first: a docstring that NAMES `text-xs` while
 * explaining a size is not a use of it.
 */
function stepsSpentInMarkup(): Set<string> {
  const spent = new Set<string>();
  for (const dir of ["apps/admin/src", "apps/public/src"]) {
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(`${UI_ROOT}${file}`, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const token of Object.keys(STEPS)) {
        // Whole class name only, so `text-xl` is not read out of
        // `text-2xl` and `text-base` not out of `text-balance`. A variant
        // or arbitrary prefix (`sm:text-lg`) still counts.
        const utility = token.replace("--text-", "text-");
        if (new RegExp(`(?<![\\w-])${utility}(?![\\w-])`).test(source)) {
          spent.add(`var(${token})`);
        }
      }
    }
  }
  return spent;
}

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
// One documented exception, narrow and pinned by an exact-match allowlist
// rather than a loophole: the header's two fluid sizes stay literal
// `clamp()`s. Their endpoints were tuned against the 768-948px overflow
// band (#221); snapping them to steps would move that tuning for no gain,
// since a clamp is not a step in any case.
//
// There was a second exception until #240. The admin app's ~40 literals
// were FROZEN rather than migrated — pinned shrink-only in a
// `FROZEN_ADMIN_SIZES` set — because the shadcn migration was going to
// replace those stylesheets wholesale and tokenizing them would have been
// churn destined for deletion. It did, and the set emptied as it went
// (#233-#238, #816, #841); the last two entries went with admin.css's
// legacy rules. Every font-size in every workspace is now a step or a
// fluid header size, so the two halves of this check are one.

/**
 * The two header sizes allowed to stay fluid literals, spelled exactly as
 * the stylesheet spells them — an exact match, so re-tuning either one is a
 * deliberate edit here rather than something a regex waves through.
 */
const FLUID_SIZES = new Set([
  "clamp(30px, 3.6vw, 40px)",
  "clamp(17px, 2.2vw, 20px)",
]);

/** Whether a value is exactly one step token, spelled as a `var()`. */
const isStep = (value: string): boolean =>
  Object.keys(STEPS).some((token) => value === `var(${token})`);

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

  // One case over every workspace, public and admin alike: the admin's
  // frozen-literal allowance went with the stylesheets that held them
  // (#240), so there is one rule for the whole site again.
  it.each(declaring("font-size"))(
    "%s sizes text with a step of the scale",
    (_label, value) => {
      expect(isStep(value) || FLUID_SIZES.has(value)).toBe(true);
    },
  );

  it("spends every step on something", () => {
    // A step nothing uses is a step nobody chose; it would drift out of the
    // set the rest of the site is actually built from. Both ways of
    // spending one count — see stepsSpentInMarkup.
    const used = new Set([
      ...declaring("font-size").map(([, value]) => value),
      ...stepsSpentInMarkup(),
    ]);
    const unused = Object.keys(STEPS).filter(
      (token) => !used.has(`var(${token})`),
    );
    expect(unused).toEqual([]);
  });
});
