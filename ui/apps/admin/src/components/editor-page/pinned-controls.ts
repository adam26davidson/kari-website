/**
 * How far below the top of `.admin-content` a focused field or the writing
 * caret has to land to clear `EditorPage`'s pinned Save/Close strip (#796),
 * in px. The strip is 72px tall when pinned at `sm` and up (16px of paper,
 * the 40px row, 16px of paper) and 56px on a phone (the buttons and 8px
 * either side); 80 clears the taller one with a little room to spare.
 *
 * The browser's and ProseMirror's own scroll-into-view know nothing of a
 * sticky element, so without this a Shift+Tab back up a tall editor, or
 * arrowing up a long post, parks the focus or caret under the strip.
 * `Tiptap` feeds it to ProseMirror's `scrollMargin`/`scrollThreshold`;
 * admin.css repeats it as `.admin-content`'s `scroll-padding-top` while an
 * editor is open, which is what the browser's focus scrolling honours.
 * test/design/pinned-controls-clearance.test.ts keeps the two equal.
 */
export const PINNED_CONTROLS_CLEARANCE = 80;
