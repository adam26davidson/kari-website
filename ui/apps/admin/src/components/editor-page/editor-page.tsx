import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { PageTitle } from "../page-title/page-title";

/**
 * A migrated admin editor's scaffold: the page title with its Save/Close
 * pair beside it, and one card holding the fields.
 *
 * Written in #233 as the Tailwind/shadcn replacement for the pre-shadcn
 * `components/data-editor`, matching it prop for prop so the sibling
 * migrations (#235-#238) were a swap rather than a rewrite. That fork is
 * gone as of #240; this is the admin's only editor scaffold.
 *
 * The structure is the boards' (`HaikuEditor.png`, `HaikuEditorMobile.png`),
 * and it is a real change from the legacy editor rather than a restyle: the
 * title and the two controls now sit ABOVE the card, on the paper, so the
 * card holds nothing but what she is editing. On a phone the title takes
 * its own line and the buttons drop below it.
 *
 * Save and Close stay on screen while a tall editor scrolls (#796): a long
 * post or a big photograph set grows the card and `.admin-content` scrolls,
 * and a Save that has scrolled off the top is no longer the screen's one
 * obvious next action (design brief §2). A save bar pinned at the top is
 * what the editors she is likeliest to know do (WordPress, Ghost, Google
 * Docs), and the controls already sat at the top, so they simply stop
 * leaving. Judged from scrolled screenshots at 1280, 834 and 390 wide:
 * - At `sm` and up the whole header row pins — it is one line, so "Edit
 *   ..." staying with the buttons costs nothing and says what she is
 *   editing.
 * - On a phone only the Save/Close row pins (a 56px strip, widened over
 *   the 8px gutters so the card cannot show beside it) and the title
 *   scrolls away: the stacked pair would park ~110px under the top bar. A
 *   sticky element only travels inside its parent, so below `sm` the row
 *   is `contents` and the controls are a direct child of the full-height
 *   column; `-mt-5` gives back the 12px title gap the column's `gap-6`
 *   would otherwise widen.
 * - The strip is plain paper (`bg-background`), `z-10` — over the card's
 *   fields and the link bubble (`z-2`), under every overlay (dialog
 *   `z-50`, assistant `z-[1000]`). Its padding is cancelled by equal
 *   negative margins, so an editor at rest sits exactly where the boards
 *   put it; the `sm` row's 16px below is where the title's swash hangs.
 * - The `top` offsets are minus `.admin-content`'s top padding (12px on a
 *   phone, 32px from `md`), because sticky measures from the scroller's
 *   content edge: at `top-0` the strip would pin 32px down with the post
 *   showing through above it.
 * - Focus and the caret are kept clear of the strip by
 *   PINNED_CONTROLS_CLEARANCE: as `.admin-content`'s scroll-padding while
 *   an editor is open (admin.css), and as ProseMirror's scroll margin
 *   (tiptap.tsx).
 * Sticky stops working under any ancestor with non-visible overflow; keep
 * `.admin-content` the only one.
 *
 * `data-editor` and `data-editor-item-controls` style nothing: they are
 * how the admin e2e journeys find an open editor and its Save and Close
 * buttons (e2e/admin-journeys.spec.ts; see the hook-class note in
 * e2e/helpers.ts). `data-slot` is shadcn's slot convention, and
 * `admin-journeys.spec.ts` locates the card inside the editor through
 * `.data-editor [data-slot="card"]`.
 */
export function EditorPage({
  children,
  /** Names what is being edited, e.g. "Edit haiku" — required so no editor
      can open as an unheaded panel of boxes (#457). */
  title,
  disableSave,
  onSave,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  disableSave?: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div
      data-slot="editor"
      className="data-editor mx-auto flex w-full max-w-[720px] flex-col gap-6"
    >
      <div className="contents sm:sticky sm:-top-3 md:-top-8 sm:z-10 sm:-my-4 sm:flex sm:flex-row sm:items-center sm:justify-between sm:bg-background sm:py-4">
        <PageTitle>{title}</PageTitle>
        <div
          data-slot="editor-controls"
          className="data-editor-item-controls sticky -top-3 z-10 -mx-2 -mt-5 -mb-2 flex shrink-0 gap-3 bg-background px-2 py-2 sm:static sm:z-auto sm:m-0 sm:bg-transparent sm:p-0"
        >
          {/* Save first and filled: the one obvious next action on this
              screen (design brief §2). Close stands beside it as the quiet
              chip, because leaving is not what she came here to do. */}
          <Button onClick={onSave} disabled={disableSave}>
            Save
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <Card className="flex flex-col gap-6 p-5 sm:p-8">{children}</Card>
    </div>
  );
}
