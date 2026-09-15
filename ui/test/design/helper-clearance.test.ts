import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES, declaration, label } from "./css-rules";

// The helper's collapsed toggle floats; the page underneath has to end
// above it.
//
// The toggle (apps/admin/src/assistant/assistant-widget.tsx) is a `fixed`
// disc in the bottom-right corner of every admin screen. On a wide desktop
// that corner is empty gutter beside the content column, so it looked
// harmless — but the admin's content column is the full viewport width on a
// phone and all but ~30px of it on a tablet, so the disc came down ON the
// last thing on the page. CI's visual review caught it on PR #874: the disc
// sat over the home editor's "See it on your site" phone preview, and over
// the photography editor's "Remove this image" button, which is a CONTROL
// she could not reach because nothing scrolled further.
//
// The fix is the one every floating action button needs: the scroll
// container reserves the disc's footprint as bottom padding, so scrolling
// to the end always parks the last content clear of it. The disc still
// passes over content mid-scroll — that is what a floating affordance does
// — but nothing is ever permanently underneath it.
//
// This is a stylesheet assertion because jsdom lays nothing out: a `fixed`
// element has no position there, and the overlap only exists on a real
// device at a real width. What is pinned here is the arithmetic — that the
// reserve still covers the disc — since the two numbers live in different
// languages (a CSS custom property, and Tailwind utilities in the TSX) and
// nothing else would notice them drifting apart.

const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const ADMIN_CSS = "apps/admin/src/admin.css";
const WIDGET = "apps/admin/src/assistant/assistant-widget.tsx";

/** The reserve token, in px. */
const RESERVE = (() => {
  const root = RULES.find(
    (rule) => rule.file === ADMIN_CSS && rule.selector === ":root",
  );
  if (!root) throw new Error(`no :root rule in ${ADMIN_CSS}`);
  const value = declaration(root.block, "--admin-helper-reserve");
  if (!value) throw new Error(`${ADMIN_CSS} declares no --admin-helper-reserve`);
  return { value, px: Number.parseFloat(value) };
})();

/**
 * The collapsed toggle's classes, read out of its `className` literal.
 * Anchored on `className="` rather than on the hook name alone, because the
 * comment above the attribute names the hook too and would otherwise be
 * what this matched.
 */
const TOGGLE_CLASSES = (() => {
  const source = readFileSync(`${UI_ROOT}${WIDGET}`, "utf-8");
  const match = source.match(/className="(admin-assistant-toggle[^"]*)"/);
  if (!match) throw new Error(`no .admin-assistant-toggle class in ${WIDGET}`);
  return match[1].split(/\s+/);
})();

/**
 * A Tailwind spacing utility's value in px. The default scale is
 * `n * 0.25rem`, and the admin has not re-based the root font size, so a
 * step is 4px.
 */
function spacing(prefix: string): number {
  const found = TOGGLE_CLASSES.find((name) =>
    new RegExp(`^${prefix}-\\d+$`).test(name),
  );
  if (!found) throw new Error(`the toggle declares no ${prefix}-<n> utility`);
  return Number(found.slice(prefix.length + 1)) * 4;
}

describe("the floating helper's clearance", () => {
  it("reserves at least the toggle's own footprint", () => {
    // How far the disc reaches up from the bottom edge: its offset plus
    // its height. Anything less than this and content still ends under it.
    const footprint = spacing("bottom") + spacing("size");

    expect(RESERVE.px).toBeGreaterThanOrEqual(footprint);
  });

  it("is spent by every padding the admin's scroller declares", () => {
    // `.admin-content` sets `padding` with the SHORTHAND, and re-sets it at
    // phone width — where the overlap is worst. A shorthand resets every
    // side, so a reserve added to the base rule alone would be thrown away
    // by the media query. Both rules have to spend the token, so this
    // asserts over all of them rather than over a chosen one.
    const paddings = RULES.filter(
      (rule) => rule.file === ADMIN_CSS && rule.selector === ".admin-content",
    ).flatMap((rule) => {
      const padding = declaration(rule.block, "padding");
      return padding ? [[label(rule), padding] as const] : [];
    });

    expect(paddings.length).toBeGreaterThan(0);
    for (const [where, padding] of paddings) {
      expect(`${where}: ${padding}`).toContain("var(--admin-helper-reserve)");
    }
  });
});
