import { describe, expect, it } from "vitest";
import { RULES, declaration } from "./css-rules";

// The admin app is mid-migration: `admin.css` still carries the unlayered
// element rules the un-migrated editors depend on (`input[type="text"] {
// width: 400px }` and friends), and each migrated component opts out of them
// through a `[data-slot="…"]` guard. The guards are load-bearing — without
// them a vendored shadcn input renders as the legacy grey 400px box, because
// an unlayered rule beats anything in `@layer utilities` whatever its
// specificity (see the comment above those rules).
//
// What this file pins is the OTHER half of that bargain: a guard must buy
// the opt-out without disturbing the cascade it leaves behind. `:not(…)`
// takes the specificity of its argument, so `input[type="text"]:not(
// [data-slot="input"])` is (0,2,1) where the bare `input[type="text"]` it
// replaced was (0,1,1) — enough to start outranking `.admin-field > input {
// width: 100% }` at (0,1,1), which until then won on source order. That is
// not a hypothetical: it puts the still-legacy other-works, haiga and
// photography editors' Title/Publisher/Subtitle boxes back at 400px inside a
// full-width card, which is exactly the lopsided panel #457 fixed. No
// rendered test can see it (jsdom lays nothing out) and the CI visual review
// is advisory, so the invariant is asserted against the stylesheet: spell
// every guard `:where(:not(…))`, whose specificity is always zero, and the
// cascade is provably the one that was there before the guard.

type Spec = [number, number, number];

const ZERO: Spec = [0, 0, 0];
const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** `> 0` when `a` outranks `b`, `0` when they tie (source order decides). */
const compare = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The end of the bracketed group opening at `start`, by balance. */
function closing(selector: string, start: number, open: string, shut: string) {
  let depth = 0;
  for (let i = start; i < selector.length; i++) {
    if (selector[i] === open) depth++;
    else if (selector[i] === shut && --depth === 0) return i;
  }
  return selector.length - 1;
}

/** Top-level `,`-separated parts of a selector list. */
function split(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = "";
  for (const char of list) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) parts.push(buffer);
  return parts;
}

/**
 * The specificity of one complex selector, per the CSS selectors spec:
 * `[ids, classes-and-attributes-and-pseudo-classes, elements]`.
 *
 * Only the constructs `admin.css` actually uses are modelled, but the three
 * that matter for this file are modelled exactly: `:where()` contributes
 * nothing whatever it wraps, `:not()`/`:is()`/`:has()` contribute the
 * specificity of their most specific argument, and a pseudo-ELEMENT (`::`)
 * counts as an element rather than a class.
 */
export function specificity(selector: string): Spec {
  let spec = ZERO;
  let i = 0;
  while (i < selector.length) {
    const char = selector[i];
    if (char === "#" || char === ".") {
      const name = /^[-\w\\]+/.exec(selector.slice(i + 1))?.[0] ?? "";
      spec = add(spec, char === "#" ? [1, 0, 0] : [0, 1, 0]);
      i += 1 + name.length;
      continue;
    }
    if (char === "[") {
      i = closing(selector, i, "[", "]") + 1;
      spec = add(spec, [0, 1, 0]);
      continue;
    }
    if (char === ":") {
      const isElement = selector[i + 1] === ":";
      const rest = selector.slice(i + (isElement ? 2 : 1));
      const name = /^[-\w]+/.exec(rest)?.[0] ?? "";
      const after = i + (isElement ? 2 : 1) + name.length;
      if (selector[after] === "(") {
        const end = closing(selector, after, "(", ")");
        const args = selector.slice(after + 1, end);
        // `:where()` is the zero-specificity wrapper; the other functional
        // pseudo-classes that take a selector list take their argument's.
        // Anything else (`:nth-child(2)`) is a plain pseudo-class.
        if (name !== "where") {
          spec = add(
            spec,
            ["not", "is", "has"].includes(name)
              ? split(args).reduce(
                  (best, arg) =>
                    compare(specificity(arg), best) > 0
                      ? specificity(arg)
                      : best,
                  ZERO,
                )
              : [0, 1, 0],
          );
        }
        i = end + 1;
        continue;
      }
      spec = add(spec, isElement ? [0, 0, 1] : [0, 1, 0]);
      i = after;
      continue;
    }
    const name = /^[-\w]+/.exec(selector.slice(i))?.[0];
    if (name) {
      spec = add(spec, [0, 0, 1]);
      i += name.length;
      continue;
    }
    i++; // Combinator, whitespace or `*`: no contribution.
  }
  return spec;
}

/** Every admin stylesheet's rules, in source order within each file. */
const ADMIN_RULES = RULES.filter((rule) =>
  rule.file.startsWith("apps/admin/src/"),
);

/** `admin.css`'s own rules, in source order. */
const ADMIN_CSS_RULES = ADMIN_RULES.filter(
  (rule) => rule.file === "apps/admin/src/admin.css",
);

/** The one rule in `admin.css` declaring `property: value`, with its index. */
function ruleDeclaring(property: string, value: string) {
  const index = ADMIN_CSS_RULES.findIndex(
    (rule) => declaration(rule.block, property) === value,
  );
  if (index === -1) {
    throw new Error(`no admin.css rule sets ${property}: ${value}`);
  }
  return { ...ADMIN_CSS_RULES[index], index };
}

describe("the legacy admin element rules", () => {
  it("let .admin-field size its own control", () => {
    // The default that makes a lone box 400px wide, and the panel rule that
    // overrides it for a labelled field. The second must keep winning, for
    // every one of the element selectors the first lists.
    const fallback = ruleDeclaring("width", "400px");
    const field = ruleDeclaring("width", "100%");
    expect(field.selector).toContain(".admin-field >");
    expect(field.index).toBeGreaterThan(fallback.index);

    const winners = split(field.selector).map((part) => specificity(part));
    for (const part of split(fallback.selector)) {
      // A tie is a win here, because `.admin-field > …` is declared later.
      const beaten = winners.some(
        (winner) => compare(specificity(part), winner) <= 0,
      );
      expect(`${part.trim()} beaten: ${beaten}`).toBe(
        `${part.trim()} beaten: true`,
      );
    }
  });

  it("carry migration guards that cost no specificity", () => {
    // Every `[data-slot]` guard in the admin stylesheets exists to let a
    // MIGRATED component out of a legacy rule. None of them may change what
    // that rule outranks for everyone still inside it, so each must weigh
    // the same as the bare selector it was bolted onto.
    const guarded = ADMIN_RULES.flatMap((rule) =>
      split(rule.selector).filter((part) => part.includes("[data-slot=")),
    );
    expect(guarded.length).toBeGreaterThan(0);
    for (const part of guarded) {
      // Both spellings are stripped, so the comparison is against the
      // pre-guard selector however the guard was written: only the
      // `:where()` one comes back equal.
      const unguarded = part
        .replace(/:where\(:not\(\[data-slot=[^\]]*\]\)\)/g, "")
        .replace(/:not\(\[data-slot=[^\]]*\]\)/g, "");
      expect(`${part.trim()} => ${specificity(part).join(",")}`).toBe(
        `${part.trim()} => ${specificity(unguarded).join(",")}`,
      );
    }
  });
});
