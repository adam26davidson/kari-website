import { Haiga } from "../../../../../Models";
import { DataEditor } from "../../../../../components/data-editor/data-editor";
import { PhotoPicker } from "../../../../../components/photo-picker/photo-picker";

export function HaigaEditor({
  haiga,
  setHaiga,
  validate,
  handleFileSelect,
  imageFile,
  onSave,
  onClose,
}: {
  haiga: Haiga;
  setHaiga: (haiga: Haiga) => void;
  validate: (haiga: Haiga) => boolean;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
      <textarea
        value={haiga.lines.join("\n")}
        placeholder={"line 1\nline 2\nline 3"}
        onChange={(e) =>
          setHaiga({ ...haiga, lines: e.target.value.split("\n") })
        }
      />
      <input
        type="text"
        placeholder="Publisher"
        value={haiga.publisher}
        onChange={(e) => setHaiga({ ...haiga, publisher: e.target.value })}
      />
      <PhotoPicker
        imageFile={imageFile}
        fileName={haiga.image}
        handleFileSelect={handleFileSelect}
      />
    </DataEditor>
  );
}
