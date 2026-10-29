import { describe, expect, it } from "vitest";
import { RULES, declarations, label } from "./css-rules";
import { jsxTag, type JsxTag } from "./class-strings";

// Nothing between the link bubble and the admin's scroller may clip (#990).
//
// The tiptap link bubble is `position: absolute`, appended by the
// bubble-menu plugin inside the `.editor` wrapper, which is `relative` so
// the bubble scrolls with its link (#700). It hangs BELOW its link (#989),
// so a last-line link's bubble reaches past `.editor`, through
// `.tiptap-container`'s border and into the card's padding. Any ancestor up
// to `.admin-content` that clips would cut it off at that edge:
//
//   .admin-content          admin.css, `overflow-y: auto` — the ONE
//     .data-editor          scroller, which clips by design and is
//       Card                excluded here; the bubble scrolling with it
//         .tiptap-container is the point of #700
//           .editor
//             (the bubble)
//
// The same rule keeps the editor's pinned Save/Close strip working (#796,
// editor-page.tsx): `position: sticky` sticks to the nearest ancestor with
// non-visible overflow, so a clipping `.data-editor` would strand it.
//
// Neither the e2e journey nor the screenshots can see a regression here:
// Playwright's `toBeVisible` and `getBoundingClientRect` are both blind to
// ancestor clipping, and the screenshot harness never opens a bubble. And
// the four inner elements have no stylesheet rule at all — they are styled
// by Tailwind class strings — so this reads the TSX as well as the CSS.
//
// Pinned beyond `overflow`, because they clip exactly the same way:
// `contain: paint|content|strict`, `clip-path`, and masks. `truncate` and
// `line-clamp-<n>` are `overflow: hidden` under another name.

const TIPTAP = "apps/admin/src/components/tiptap/tiptap.tsx";
const EDITOR_PAGE = "apps/admin/src/components/editor-page/editor-page.tsx";
const CARD = "apps/admin/src/components/ui/card.tsx";

/**
 * A Tailwind utility that clips its element's overflow, whatever variants
 * prefix it (`sm:`, `hover:`, `[&>*]:`) or `!` marks it important. Every
 * `overflow` value except `visible` clips — `auto` and `scroll` too.
 */
const CLIPPING_UTILITY = new RegExp(
  "(?:^|:)!?(?:" +
    [
      "overflow-(?!(?:[xy]-)?visible\\b)[\\w-]+",
      "truncate",
      "line-clamp-(?!none\\b)[\\w\\[\\]./-]+",
      "contain-(?:paint|content|strict)",
      "mask-[\\w\\[\\]()/.,%#-]+",
      "\\[(?:overflow(?:-[xy])?:(?!visible\\])|contain:[^\\]]*(?:paint|content|strict)|clip-path:|mask(?:-image)?:)[^\\]]*\\]",
    ].join("|") +
    ")!?$",
);

const clips = (utility: string) => CLIPPING_UTILITY.test(utility);

/** A stylesheet declaration that clips its element's overflow. */
function clipsDeclaration(property: string, value: string): boolean {
  const v = value.replace(/\s*!important$/, "").trim();
  if (/^overflow(-[xy])?$/.test(property)) return v !== "visible";
  if (property === "contain") return /\b(paint|content|strict)\b/.test(v);
  if (["clip-path", "mask", "mask-image", "clip"].includes(property)) {
    return v !== "none" && v !== "auto";
  }
  return false;
}

/** The chain's elements, inner to outer, each found by what marks it. */
const CHAIN: Array<{ name: string; tag: () => JsxTag }> = [
  {
    name: ".editor (the bubble's containing block)",
    tag: () =>
      jsxTag(TIPTAP, ".editor", (tag) => tag.classes.includes("editor")),
  },
  {
    name: ".tiptap-container",
    tag: () =>
      jsxTag(TIPTAP, ".tiptap-container", (tag) =>
        tag.classes.includes("tiptap-container"),
      ),
  },
  {
    name: "the editor's Card, as EditorPage renders it",
    tag: () => jsxTag(EDITOR_PAGE, "<Card>", (tag) => tag.name === "Card"),
  },
  {
    name: "the Card primitive itself",
    tag: () =>
      jsxTag(CARD, 'data-slot="card"', (tag) =>
        tag.source.includes('data-slot="card"'),
      ),
  },
  {
    name: ".data-editor",
    tag: () =>
      jsxTag(EDITOR_PAGE, ".data-editor", (tag) =>
        tag.classes.includes("data-editor"),
      ),
  },
];

/**
 * Whether a selector's SUBJECT (the compound after its last combinator) is
 * one of the chain's elements. `.editor .ProseMirror` styles a descendant,
 * not `.editor`, and the bubble is not inside `.ProseMirror`.
 */
const CHAIN_SUBJECT =
  /(?:\.(?:editor|tiptap-container|data-editor)(?![\w-])|\[data-slot=["']?(?:card|editor)["']?\])/;

/** `selector` with every functional pseudo-class's argument dropped. */
function withoutArguments(selector: string): string {
  let previous: string;
  let current = selector;
  do {
    previous = current;
    current = current.replace(/\([^()]*\)/g, "");
  } while (current !== previous);
  return current;
}

/**
 * The utilities a block pulls in through Tailwind's `@apply` — the
 * idiomatic Tailwind v4 way to give a rule a class's declarations, and one
 * `declarations()` cannot see, since `@apply overflow-hidden` has no colon.
 */
const appliedUtilities = (block: string): string[] =>
  [...block.matchAll(/@apply\s+([^;}]+)/g)].flatMap((match) =>
    match[1].trim().split(/\s+/),
  );

// `:has(…)`, `:not(…)` and friends are dropped first: `.admin-content:has(
// [data-slot="editor"])` styles the scroller, not the editor inside it.
const targetsChain = (selector: string) =>
  withoutArguments(selector)
    .split(",")
    .some((part) => {
      const compounds = part.trim().split(/\s*[\s>+~]\s*/);
      return CHAIN_SUBJECT.test(compounds.at(-1) ?? "");
    });

describe("the link bubble's ancestors", () => {
  describe.each(CHAIN)("$name", ({ tag }) => {
    it("has a className this test can read", () => {
      // Guards the assertion below from passing vacuously: every element
      // in the chain is styled by utilities today.
      expect(tag().classes.length).toBeGreaterThan(0);
    });

    it("sets no clipping utility", () => {
      expect(tag().classes.filter(clips)).toEqual([]);
    });
  });

  it("are given no clipping declaration by any stylesheet", () => {
    const clipping = RULES.filter((rule) =>
      targetsChain(rule.selector),
    ).flatMap((rule) => [
      ...declarations(rule.block)
        .filter((decl) => clipsDeclaration(decl.property, decl.value))
        .map((decl) => `${label(rule)}: ${decl.property}: ${decl.value}`),
      ...appliedUtilities(rule.block)
        .filter(clips)
        .map((utility) => `${label(rule)}: @apply ${utility}`),
    ]);
    expect(clipping).toEqual([]);
  });
});

describe("the clipping-utility matcher", () => {
  it.each([
    "overflow-hidden",
    "overflow-clip",
    "overflow-auto",
    "overflow-y-scroll",
    "overflow-x-hidden",
    "sm:overflow-hidden",
    "!overflow-hidden",
    "[&>*]:overflow-clip",
    "truncate",
    "line-clamp-3",
    "contain-paint",
    "contain-strict",
    "mask-b-from-50%",
    "[overflow:hidden]",
    "[clip-path:inset(0)]",
    "[contain:layout_paint]",
  ])("catches %s", (utility) => {
    expect(clips(utility)).toBe(true);
  });

  it.each([
    "overflow-visible",
    "overflow-x-visible",
    "line-clamp-none",
    "contain-layout",
    "rounded-lg",
    "relative",
    "text-ellipsis",
    "[overflow:visible]",
  ])("lets %s through", (utility) => {
    expect(clips(utility)).toBe(false);
  });
});

describe("the @apply reader", () => {
  it("splits every @apply statement into its utilities", () => {
    expect(
      appliedUtilities(
        "color: red; @apply rounded-lg sm:overflow-hidden;\n" +
          "  @apply\n    truncate !contain-paint",
      ),
    ).toEqual([
      "rounded-lg",
      "sm:overflow-hidden",
      "truncate",
      "!contain-paint",
    ]);
  });

  it("finds nothing in a block without one", () => {
    expect(appliedUtilities("overflow: visible; position: relative")).toEqual(
      [],
    );
  });
});

describe("the chain's stylesheet selector matcher", () => {
  it.each([
    ".editor",
    ".tiptap-container",
    '[data-slot="card"]',
    ".admin-content .data-editor",
    "main > [data-slot=editor]",
  ])("treats %s as a chain element", (selector) => {
    expect(targetsChain(selector)).toBe(true);
  });

  it.each([
    ".editor .ProseMirror",
    ".editor-toolbar",
    ".admin-content",
    '.admin-content:has([data-slot="editor"])',
  ])("leaves %s alone", (selector) => {
    expect(targetsChain(selector)).toBe(false);
  });
});
