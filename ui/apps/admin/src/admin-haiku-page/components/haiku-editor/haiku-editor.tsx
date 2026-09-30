import { useId } from "react";
import { EditorPage } from "../../../components/editor-page/editor-page";
import { FieldLabel } from "../../../components/field-label/field-label";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { Haiku } from "@kari/shared/models";

export function HaikuEditor({
  haiku,
  setHaiku,
  onSave,
  onClose,
  saveDisabled,
}: {
  haiku: Haiku;
  setHaiku: (haiku: Haiku) => void;
  onSave: () => void;
  onClose: () => void;
  saveDisabled: boolean;
}) {
  const linesId = useId();
  const linesHintId = useId();
  const publisherId = useId();
  const publisherHintId = useId();
  return (
    <EditorPage
      title="Edit haiku"
      onSave={onSave}
      onClose={onClose}
      disableSave={saveDisabled}
    >
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={linesId}>Haiku</FieldLabel>
        <Textarea
          id={linesId}
          aria-describedby={linesHintId}
          value={haiku.lines.join("\n")}
          // Kept: this is an example of the expected shape (one line per
          // line), not a restatement of the label.
          placeholder={"line 1\nline 2\nline 3"}
          onChange={(e) =>
            setHaiku({
              ...haiku,
              lines: e.target.value.split("\n"),
            })
          }
        />
        {/* Said once, in her words, and said BEFORE she submits rather than
            after (design brief §9, §10) — the box splits on newlines, and
            what she types is what the public page shows.

            It sits under the box it describes rather than at the foot of
            the card, where `HaikuEditor.png` draws it. The boards drew one
            explanation on a card with two fields; now that Publisher has
            its own, a line at the foot would read as belonging to the
            field directly above it — the wrong one (#695). Field-level
            placement is the brief's own §9/§10 ("say what is expected
            before she submits"), which the boards' README defers to. */}
        <p id={linesHintId} className="text-muted-foreground font-sans text-sm">
          One line of the haiku per line of the box — it appears on the site
          exactly as typed.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {/* "(optional)" because nothing here requires it — Save is gated on
            the first line alone — and the photography editor already says so
            this way on its own optional fields. */}
        <FieldLabel htmlFor={publisherId}>Publisher (optional)</FieldLabel>
        <Input
          id={publisherId}
          type="text"
          aria-describedby={publisherHintId}
          value={haiku.publisher}
          onChange={(e) => setHaiku({ ...haiku, publisher: e.target.value })}
        />
        {/* "Publisher" was the one field on this card that named itself and
            nothing else: a bare noun gives no clue whether it wants a
            journal, a person or a web address, nor what filling it does
            (#695). What she actually puts there is a credit — "Wales Haiku
            Journal, Spring 2026", "Honorable Mention, 21st Mainichi Haiku
            Contest" — and the public Haiku page renders it as the small
            muted line under the poem (`haiku-content.tsx`). So the hint
            says both: what it is for, and where it lands. */}
        <p
          id={publisherHintId}
          className="text-muted-foreground font-sans text-sm"
        >
          Where the haiku was published, or a prize it won — it appears under
          the poem on the site.
        </p>
      </div>
    </EditorPage>
  );
}
