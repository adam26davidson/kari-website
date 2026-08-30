import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A tiny stylesheet reader shared by the CSS-invariant tests
// (type-scale.test.ts, viewport-shell.test.ts). Those tests assert on what
// the stylesheets DECLARE rather than on what a browser computes, because
// jsdom does not lay anything out and the properties in question (font
// weight against font size, viewport units, overflow propagation) only
// misbehave on a real device. A flat regex parse is enough for that: the
// rules being pinned are hand-written, flat, and stay that way.
//
// Deliberately not a CSS parser. It has no notion of specificity and assumes
// declarations are `property: value` pairs separated by semicolons. At-rule
// wrappers are flattened — the rules inside one are returned in their own
// right — but each rule records the wrappers it sat in, because "declared"
// and "declared unconditionally" are different claims: a declaration inside
// `@supports (height: 100dvh)` applies only where that unit is understood.

// Every workspace's stylesheets, not one app's: several of these invariants
// are cross-app claims (the admin panels use the same tint as the public
// card; both shells size themselves the same way), so the reader has to see
// apps/public, apps/admin and packages/shared alike. Resolved from this
// file's own location so the paths never depend on the working directory
// vitest happens to run in.
const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where the stylesheets live, as ui-relative directory paths. */
const SOURCE_DIRS = [
  "apps/public/src",
  "apps/admin/src",
  "packages/shared/src",
];

/** The shared stylesheet holding the tokens and the app shell. */
export const INDEX_CSS = "packages/shared/src/styles/index.css";

/** Every CSS file under `dir`, as ui-relative paths. */
function cssFiles(dir: string): string[] {
  return readdirSync(`${UI_ROOT}${dir}`, { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return cssFiles(path);
      return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
    },
  );
}

// Comments are stripped so an explanatory `/* ... */` between declarations
// can't hide the declaration that follows it from the regexes above it.
const read = (path: string) =>
  readFileSync(`${UI_ROOT}${path}`, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

export interface Rule {
  file: string;
  selector: string;
  block: string;
  /**
   * The preludes of the at-rules wrapping this rule, outermost first — e.g.
   * `["@supports (height: 100dvh)"]`. Empty for a rule that applies
   * unconditionally.
   */
  atRules: string[];
}

interface Frame {
  prelude: string;
  /** Whether this block contained blocks of its own (so it is a wrapper). */
  hasNested: boolean;
}

/** Whitespace-normalized, so a prelude reads the same however it was wrapped. */
const normalize = (text: string) => text.trim().replace(/\s+/g, " ");

/**
 * Every rule in one stylesheet, in source order. Blocks are matched by
 * scanning braces rather than by one regex, so a nested block (`@media
 * { .a { ... } }`) yields the inner rule with the wrapper recorded in
 * `atRules` instead of being flattened into an anonymous match.
 */
function parse(file: string, css: string): Rule[] {
  const rules: Rule[] = [];
  const stack: Frame[] = [];
  let buffer = "";
  for (const char of css) {
    if (char === "{") {
      stack.push({ prelude: normalize(buffer), hasNested: false });
      buffer = "";
      continue;
    }
    if (char !== "}") {
      buffer += char;
      continue;
    }
    const frame = stack.pop();
    if (frame === undefined) continue; // Unbalanced `}`; nothing to close.
    // A block holding other blocks is a wrapper, not a declaration block:
    // `@media (...) { ... }` declares nothing of its own. `@font-face`,
    // which holds declarations only, is a rule like any other.
    if (!frame.hasNested) {
      rules.push({
        file,
        selector: frame.prelude,
        block: buffer,
        atRules: stack.map((outer) => outer.prelude),
      });
    }
    const parent = stack.at(-1);
    if (parent) parent.hasNested = true;
    buffer = "";
  }
  return rules;
}

/** Every rule in every stylesheet, flattened (at-rule wrappers included). */
export const RULES: Rule[] = SOURCE_DIRS.flatMap((dir) =>
  cssFiles(dir).flatMap((file) => parse(file, read(file))),
);

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
export const label = (rule: Rule) =>
  `${rule.file} { ${[...rule.atRules, rule.selector].join(" ")} }`;

/** Every rule declaring `property`, as `[label, value]` pairs. */
export const declaring = (property: string): Array<[string, string]> =>
  RULES.flatMap((rule) => {
    const value = declaration(rule.block, property);
    return value ? [[label(rule), value] satisfies [string, string]] : [];
  });

/**
 * The UNCONDITIONAL rule in the shared index.css whose selector is exactly
 * `selector` — an at-rule-wrapped rule for the same selector is a different
 * claim (it applies only where its condition holds), so callers that want
 * one ask `RULES` for it by its `atRules`.
 */
export function indexRule(selector: string): Rule {
  const rule = RULES.find(
    (candidate) =>
      candidate.file === INDEX_CSS &&
      candidate.selector === selector &&
      candidate.atRules.length === 0,
  );
  if (!rule) throw new Error(`no ${selector} rule in index.css`);
  return rule;
}
