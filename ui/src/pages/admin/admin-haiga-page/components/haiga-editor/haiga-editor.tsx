import { Haiga } from "../../../../../models";
import { DataEditor } from "../../../components/data-editor/data-editor";
import { PhotoPicker } from "../../../components/photo-picker/photo-picker";
import "./haiga-editor.css";

export function HaigaEditor({
  haiga,
  setHaiga,
  saveDisabled,
  setImageFile,
  imageFile,
  onSave,
  onClose,
}: {
  haiga: Haiga;
  setHaiga: (haiga: Haiga) => void;
  saveDisabled: boolean;
  setImageFile: (file: File | null) => void;
  imageFile: File | null;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <DataEditor onSave={onSave} onClose={onClose} disableSave={saveDisabled}>
      <div className="haiga-editor">
        <PhotoPicker
          imageFile={imageFile}
          fileName={haiga.image}
          setImageFile={setImageFile}
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
