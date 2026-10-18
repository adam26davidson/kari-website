import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES, declaration } from "./css-rules";

// The admin's content gutter on a phone (#918).
//
// Every admin page sits directly in the shell's `.admin-content` scroller,
// and below `sm` none of them adds a horizontal inset of its own — so the
// scroller's side padding IS the distance between her words and the edge
// of the screen. It was 8px, which put headings and body copy all but on
// the glass and left the content narrower-set than the top bar above it:
// the one inconsistency the eye picks up first on a 390px phone. The
// design boards (docs/design/admin-redesign/*Mobile.png) draw an 18px
// gutter on both sides of every mobile screen.
//
// A stylesheet assertion, as with the other design invariants here: jsdom
// lays nothing out, so the gutter only exists on a real device. What is
// pinned is the declared padding, against the boards and against the top
// bar's own inset (a Tailwind utility in the TSX, which nothing else would
// notice drifting apart from the CSS).

const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const ADMIN_CSS = "apps/admin/src/admin.css";
const TOP_BAR = "apps/admin/src/components/app-shell/top-bar.tsx";

/** The gutter every *Mobile.png board draws, in px. */
const BOARD_GUTTER = 18;

/**
 * A shorthand's values, split on the spaces outside any parentheses — the
 * bottom side is a `calc()` around a `var()`, with spaces of its own.
 */
function topLevelWords(value: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let word = "";
  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (word) words.push(word);
      word = "";
    } else {
      word += char;
    }
  }
  if (word) words.push(word);
  return words;
}

/** The phone rule's `padding` shorthand, split into its four sides. */
const PHONE_PADDING = (() => {
  const rule = RULES.find(
    (candidate) =>
      candidate.file === ADMIN_CSS &&
      candidate.selector === ".admin-content" &&
      candidate.atRules.some((at) => at.includes("max-width")),
  );
  if (!rule) throw new Error(`no phone .admin-content rule in ${ADMIN_CSS}`);
  const padding = declaration(rule.block, "padding");
  if (!padding) throw new Error("the phone .admin-content sets no padding");
  const sides = topLevelWords(padding);
  if (sides.length !== 3 && sides.length !== 4) {
    throw new Error(`unexpected padding shorthand: ${padding}`);
  }
  const right = Number.parseFloat(sides[1]);
  const left = Number.parseFloat(sides[3] ?? sides[1]);
  return { left, right };
})();

/** The top bar's horizontal inset, from its `px-<n>` utility, in px. */
const TOP_BAR_INSET = (() => {
  const source = readFileSync(`${UI_ROOT}${TOP_BAR}`, "utf-8");
  const match = source.match(/\bpx-(\d+)\b/);
  if (!match) throw new Error(`the top bar declares no px-<n> in ${TOP_BAR}`);
  // Tailwind's default scale: a step is 0.25rem, 4px at the admin's root.
  return Number(match[1]) * 4;
})();

describe("the admin's phone gutter", () => {
  it("is the same on both sides", () => {
    expect(PHONE_PADDING.left).toBe(PHONE_PADDING.right);
  });

  it("is at least the gutter the design boards draw", () => {
    expect(PHONE_PADDING.left).toBeGreaterThanOrEqual(BOARD_GUTTER);
  });

  it("is never tighter than the top bar above it", () => {
    expect(PHONE_PADDING.left).toBeGreaterThanOrEqual(TOP_BAR_INSET);
  });
});
