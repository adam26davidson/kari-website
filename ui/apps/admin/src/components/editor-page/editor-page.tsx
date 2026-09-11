import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { PageTitle } from "../page-title/page-title";

/**
 * A migrated admin editor's scaffold: the page title with its Save/Close
 * pair beside it, and one card holding the fields.
 *
 * The Tailwind/shadcn replacement for `components/data-editor`, which it
 * deliberately matches prop for prop so the sibling migrations (#235-#238)
 * are a swap rather than a rewrite. Both exist until the last legacy editor
 * has moved and the fork dies (#240).
 *
 * The structure is the boards' (`HaikuEditor.png`, `HaikuEditorMobile.png`),
 * and it is a real change from the legacy editor rather than a restyle: the
 * title and the two controls now sit ABOVE the card, on the paper, so the
 * card holds nothing but what she is editing. On a phone the title takes
 * its own line and the buttons drop below it.
 *
 * `data-editor` and `data-editor-item-controls` are NOT styling — the
 * stylesheet they came from opts out of both through
 * `:not([data-slot="editor"])` / `:not([data-slot="editor-controls"])`.
 * They are how the admin e2e journeys find an open editor and its Save and
 * Close buttons (e2e/admin-journeys.spec.ts), the same convention
 * `home-page-editor` and `AdminButton`'s LEGACY_CLASS document.
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageTitle>{title}</PageTitle>
        <div
          data-slot="editor-controls"
          className="data-editor-item-controls flex shrink-0 gap-3"
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
