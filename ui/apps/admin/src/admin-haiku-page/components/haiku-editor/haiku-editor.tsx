import { useId } from "react";
import { DataEditor } from "../../../components/data-editor/data-editor";
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
    <DataEditor
      title="Edit haiku"
      onSave={onSave}
      onClose={onClose}
      disableSave={saveDisabled}
    >
      <div className="admin-field">
        <label className="admin-field-label" htmlFor={linesId}>
          Haiku
        </label>
        <textarea
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
      <div className="admin-field">
        <label className="admin-field-label" htmlFor={publisherId}>
          Publisher
        </label>
        <input
          id={publisherId}
          type="text"
          value={haiku.publisher}
          onChange={(e) => setHaiku({ ...haiku, publisher: e.target.value })}
        />
      </div>
    </DataEditor>
  );
}
