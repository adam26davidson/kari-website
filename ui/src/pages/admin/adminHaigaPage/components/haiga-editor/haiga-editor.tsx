import { Haiga } from "../../../../../Models";
import { DataEditor } from "../../../../../components/data-editor/data-editor";
import { PhotoPicker } from "../../../../../components/photo-picker/photo-picker";
import "./haiga-editor.css";

export function HaigaEditor({
  haiga,
  setHaiga,
  validate,
  setImageFile,
  imageFile,
  onSave,
  onClose,
}: {
  haiga: Haiga;
  setHaiga: (haiga: Haiga) => void;
  validate: (haiga: Haiga) => boolean;
  setImageFile: (file: File | null) => void;
  imageFile: File | null;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <DataEditor
      onSave={onSave}
      onClose={onClose}
      disableSave={!validate(haiga)}
    >
      <div className="haiga-editor">
        <PhotoPicker
          imageFile={imageFile}
          fileName={haiga.image}
          setImageFile={setImageFile}
        />
        <textarea
          value={haiga.lines.join("\n")}
          placeholder={"line 1\nline 2\nline 3"}
          onChange={(e) =>
            setHaiga({
              ...haiga,
              lines: e.target.value.split("\n"),
            })
          }
        />
        <input
          type="text"
          placeholder="Publisher"
          value={haiga.publisher}
          onChange={(e) => setHaiga({ ...haiga, publisher: e.target.value })}
        />
      </div>
    </DataEditor>
  );
}
