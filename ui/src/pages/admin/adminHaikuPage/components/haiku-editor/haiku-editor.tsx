import { DataEditor } from "../../../../../components/data-editor/data-editor";
import { Haiku } from "../../../../../Models";

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
  return (
    <DataEditor onSave={onSave} onClose={onClose} disableSave={saveDisabled}>
      <textarea
        value={haiku.lines.join("\n")}
        placeholder={"line 1\nline 2\nline 3"}
        onChange={(e) =>
          setHaiku({
            ...haiku,
            lines: e.target.value.split("\n"),
          })
        }
      />
      <input
        type="text"
        placeholder="Publisher"
        value={haiku.publisher}
        onChange={(e) => setHaiku({ ...haiku, publisher: e.target.value })}
      />
    </DataEditor>
  );
}
