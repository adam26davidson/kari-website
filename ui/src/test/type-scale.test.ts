import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

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

const SRC = "src";
const DISPLAY_TOKEN = "--display-weight";

/** The smallest weight the display token is allowed to be spent on. */
const DISPLAY_SIZE_FLOOR_PX = 18;

/** Every CSS file under src/, as repo-relative paths. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return cssFiles(path);
    return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
  });
}

// Comments are stripped so an explanatory `/* ... */` between declarations
// can't hide the declaration that follows it from the regexes below (the
// same treatment text-contrast.test.ts gives its stylesheets).
const read = (path: string) =>
  readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  file: string;
  selector: string;
  block: string;
}

/** Every rule in every stylesheet, flattened (at-rule wrappers included). */
const RULES: Rule[] = cssFiles(SRC).flatMap((file) => {
  const css = read(file);
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, block]) => ({ file, selector: selector.trim(), block }),
  );
});

function declaration(block: string, property: string): string | undefined {
  const match = block.match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`),
  );
  return match?.[1].trim();
}

const label = (rule: Rule) => `${rule.file} { ${rule.selector} }`;

/** Every rule declaring `property`, as `[label, value]` pairs. */
const declaring = (property: string): Array<[string, string]> =>
  RULES.flatMap((rule) => {
    const value = declaration(rule.block, property);
    return value ? [[label(rule), value] satisfies [string, string]] : [];
  });

/**
 * Whether a weight value is at or above regular. `bold`/`bolder` are, the
 * bare numbers speak for themselves, and `lighter` is by definition not.
 */
function isRegularOrHeavier(value: string): boolean {
  if (value === "normal" || value === "bold" || value === "bolder") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 400;
}

describe("the weight axis of the type scale", () => {
  it("leaves body text at regular weight, not the hairline 300", () => {
    const body = RULES.find(
      (rule) => rule.file === `${SRC}/index.css` && rule.selector === "body",
    );
    if (!body) throw new Error("no body rule in index.css");
    const weight = declaration(body.block, "font-weight");
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
  )("%s spends the display weight on text of at least 18px", (_label, block) => {
    const size = declaration(block, "font-size");
    expect(size).toBeDefined();
    // A fluid size (clamp/min/max) is judged on its smallest px value —
    // that is the width at which its stems are thinnest.
    const pxValues = (size as string)
      .match(/([\d.]+)px/g)
      ?.map((px) => Number.parseFloat(px));
    expect(pxValues?.length).toBeGreaterThan(0);
    expect(Math.min(...(pxValues as number[]))).toBeGreaterThanOrEqual(
      DISPLAY_SIZE_FLOOR_PX,
    );
  });

  it("keeps the display token itself light — it has no other purpose", () => {
    const root = RULES.find(
      (rule) => rule.file === `${SRC}/index.css` && rule.selector === ":root",
    );
    if (!root) throw new Error("no :root rule in index.css");
    const value = Number(declaration(root.block, DISPLAY_TOKEN));
    expect(value).toBeGreaterThanOrEqual(200);
    expect(value).toBeLessThan(400);
  });
});
