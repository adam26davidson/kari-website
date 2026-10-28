import { readFileSync } from "node:fs";
import { UI_ROOT } from "./css-rules";

// A tiny JSX reader for the design invariants that live in Tailwind class
// strings rather than in a stylesheet (#990). The admin is styled almost
// entirely by utilities in its TSX, so an invariant checked against
// css-rules.ts alone passes vacuously for any element that has no
// stylesheet rule — which is most of them.
//
// Like css-rules.ts, deliberately not a parser. It finds JSX opening tags
// by scanning for `<Name` and walking to the `>` that closes the tag
// (skipping the ones inside `{...}` expressions and quoted strings), then
// reads the tag's `className` — a plain `"..."` literal, or every string
// literal inside a `{...}` expression, so `className={cn("a", "b")}`
// yields both. A class built at runtime from variables is invisible to it;
// the elements these tests pin are written as literals and stay that way.

export interface JsxTag {
  /** The ui-relative file the tag is in. */
  file: string;
  /** The tag name: `div`, `Card`, `EditorContent`. */
  name: string;
  /** The opening tag's full source, `<` to `>`. */
  source: string;
  /** Every class its `className` names, in source order. */
  classes: string[];
}

/**
 * The source with its comments blanked out, so a `<Card>` or a class name
 * quoted in a comment is never mistaken for code. A `//` only starts a
 * comment where it cannot be inside a URL in a string (`"https://…"`).
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/**
 * The index just past the quoted string starting at `start` (whose quote
 * character is `source[start]`).
 */
function skipString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    i += source[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}

/** The index just past the `}` matching the `{` at `start`. */
function skipBraces(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(source, i);
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return i;
}

/** Every string literal's contents in `expression`, `${…}` holes dropped. */
const stringLiterals = (expression: string) =>
  [...expression.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((match) =>
    (match[1] ?? match[2] ?? match[3]).replace(/\$\{[^}]*\}/g, " "),
  );

/** The classes a tag's `className` attribute names. */
function classesOf(tag: string): string[] {
  const at = tag.search(/\bclassName=/);
  if (at === -1) return [];
  const valueStart = tag.indexOf("=", at) + 1;
  const value =
    tag[valueStart] === "{"
      ? tag.slice(valueStart, skipBraces(tag, valueStart))
      : tag.slice(valueStart, skipString(tag, valueStart));
  return stringLiterals(value).flatMap((literal) =>
    literal.split(/\s+/).filter(Boolean),
  );
}

/** Every JSX opening tag in one ui-relative TSX file, in source order. */
export function jsxTags(file: string): JsxTag[] {
  const source = stripComments(readFileSync(`${UI_ROOT}${file}`, "utf-8"));
  const tags: JsxTag[] = [];
  for (const match of source.matchAll(/<([A-Za-z][\w.]*)/g)) {
    const start = match.index;
    let i = start + match[0].length;
    while (i < source.length && source[i] !== ">") {
      const char = source[i];
      if (char === "{") i = skipBraces(source, i);
      else if (char === '"' || char === "'") i = skipString(source, i);
      else i += 1;
    }
    const tag = source.slice(start, i + 1);
    tags.push({ file, name: match[1], source: tag, classes: classesOf(tag) });
  }
  return tags;
}

/**
 * The ONE opening tag in `file` matching `predicate`. Throws on none or
 * several, so a test pinning an element fails loudly when the element is
 * renamed or duplicated instead of quietly asserting about nothing.
 */
export function jsxTag(
  file: string,
  description: string,
  predicate: (tag: JsxTag) => boolean,
): JsxTag {
  const found = jsxTags(file).filter(predicate);
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one ${description} in ${file}, found ${found.length}`,
    );
  }
  return found[0];
}
