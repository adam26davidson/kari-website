import { useId } from "react";
import { EditorPage } from "../../../components/editor-page/editor-page";
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
  const publisherId = useId();
  return (
    <EditorPage
      title="Edit haiku"
      onSave={onSave}
      onClose={onClose}
      disableSave={saveDisabled}
    >
      <div className="flex flex-col gap-2">
        <label
          className="text-muted-foreground font-sans text-sm"
          htmlFor={linesId}
        >
          Haiku
        </label>
        <Textarea
          id={linesId}
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
      </div>
      <div className="flex flex-col gap-2">
        <label
          className="text-muted-foreground font-sans text-sm"
          htmlFor={publisherId}
        >
          Publisher
        </label>
        <Input
          id={publisherId}
          type="text"
          value={haiku.publisher}
          onChange={(e) => setHaiku({ ...haiku, publisher: e.target.value })}
        />
      </div>
      {/* Said once, in her words, and said BEFORE she submits rather than
          after (design brief §9, §10) — the box splits on newlines, and
          what she types is what the public page shows. The boards keep this
          line on the card permanently rather than as a hint that appears
          when something is wrong (`HaikuEditor.png`). */}
      <p className="text-muted-foreground font-sans text-sm">
        One line of the haiku per line of the box — it appears on the site
        exactly as typed.
      </p>
    </EditorPage>
  );
}
