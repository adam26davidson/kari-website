import { describe, expect, it } from "vitest";
import { RULES, declaration } from "./css-rules";
import { PINNED_CONTROLS_CLEARANCE } from "../../apps/admin/src/components/editor-page/pinned-controls";

// An open editor pins its Save/Close strip to the top of `.admin-content`
// (#796). Two scroll-into-view mechanisms have to be told to land below
// it: the browser's focus scrolling, through the scroller's
// `scroll-padding-top` in admin.css, and ProseMirror's caret scrolling,
// through PINNED_CONTROLS_CLEARANCE in tiptap.tsx. The two numbers live in
// different languages and nothing else would notice them drift apart —
// a Shift+Tab would start landing under the strip while arrowing through a
// post still looked fine, or the other way round.

const ADMIN_CSS = "apps/admin/src/admin.css";

describe("the pinned editor controls' clearance", () => {
  it("is the same for focus scrolling and the caret", () => {
    const rule = RULES.find(
      (r) =>
        r.file === ADMIN_CSS &&
        r.selector === '.admin-content:has([data-slot="editor"])',
    );
    expect(rule, "admin.css's open-editor scroller rule").toBeDefined();
    const padding = declaration(rule!.block, "scroll-padding-top");

    expect(padding).toBe(`${PINNED_CONTROLS_CLEARANCE}px`);
  });
});
