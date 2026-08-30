import { readFileSync, readdirSync } from "node:fs";

// A tiny stylesheet reader shared by the CSS-invariant tests
// (type-scale.test.ts, viewport-shell.test.ts). Those tests assert on what
// the stylesheets DECLARE rather than on what a browser computes, because
// jsdom does not lay anything out and the properties in question (font
// weight against font size, viewport units, overflow propagation) only
// misbehave on a real device. A flat regex parse is enough for that: the
// rules being pinned are hand-written, flat, and stay that way.
//
// Deliberately not a CSS parser. It flattens at-rule wrappers into rules of
// their own rather than nesting them, has no notion of specificity, and
// assumes declarations are `property: value` pairs separated by semicolons.

const SRC = "src";

/** Every CSS file under src/, as repo-relative paths. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return cssFiles(path);
    return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
  });
}

// Comments are stripped so an explanatory `/* ... */` between declarations
// can't hide the declaration that follows it from the regexes above it.
const read = (path: string) =>
  readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

export interface Rule {
  file: string;
  selector: string;
  block: string;
}

/** Every rule in every stylesheet, flattened (at-rule wrappers included). */
export const RULES: Rule[] = cssFiles(SRC).flatMap((file) => {
  const css = read(file);
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, block]) => ({ file, selector: selector.trim(), block }),
  );
});

/** The first value a block declares for `property`, trimmed. */
export function declaration(
  block: string,
  property: string,
): string | undefined {
  const match = block.match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`),
  );
  return match?.[1].trim();
}

export interface Declaration {
  property: string;
  value: string;
}

/**
 * Every declaration in a block, in source order and including repeats — so
 * a caller can reason about which of two declarations of the same property
 * wins, which is the whole point of a fallback line followed by its modern
 * replacement. `declaration` above only ever sees the first one.
 *
 * Splits on `;` and on each declaration's FIRST `:`, so values containing a
 * colon (`background-image: url(https://...)`) survive intact.
 */
export function declarations(block: string): Declaration[] {
  return block
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const colon = part.indexOf(":");
      if (colon === -1) return [];
      return [
        {
          property: part.slice(0, colon).trim(),
          value: part.slice(colon + 1).trim(),
        },
      ];
    });
}

/** A rule, named the way a failing test should name it. */
export const label = (rule: Rule) => `${rule.file} { ${rule.selector} }`;

/** Every rule declaring `property`, as `[label, value]` pairs. */
export const declaring = (property: string): Array<[string, string]> =>
  RULES.flatMap((rule) => {
    const value = declaration(rule.block, property);
    return value ? [[label(rule), value] satisfies [string, string]] : [];
  });

/** The rule in `src/index.css` whose selector is exactly `selector`. */
export function indexRule(selector: string): Rule {
  const rule = RULES.find(
    (candidate) =>
      candidate.file === `${SRC}/index.css` && candidate.selector === selector,
  );
  if (!rule) throw new Error(`no ${selector} rule in index.css`);
  return rule;
}
