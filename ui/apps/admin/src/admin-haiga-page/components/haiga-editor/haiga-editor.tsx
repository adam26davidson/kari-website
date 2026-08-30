import { useId } from "react";
import { Haiga } from "@kari/shared/models";
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
  const publisherId = useId();
  return (
    <DataEditor
      title="Edit haiga"
      onSave={onSave}
      onClose={onClose}
      disableSave={saveDisabled}
    >
      <div className="haiga-editor">
        <div className="admin-field">
          {/* The picker is a composite (preview + file input + button), so
              this labels the group rather than pointing at one control. */}
          <span className="admin-field-label">Image</span>
          <PhotoPicker
            imageFile={imageFile}
            fileName={haiga.image}
            setImageFile={setImageFile}
          />
        </div>
        <div className="admin-field">
          <label className="admin-field-label" htmlFor={publisherId}>
            Publisher
          </label>
          <input
            id={publisherId}
            type="text"
            value={haiga.publisher}
            onChange={(e) => setHaiga({ ...haiga, publisher: e.target.value })}
          />
        </div>
      </div>
    </DataEditor>
  );
}
