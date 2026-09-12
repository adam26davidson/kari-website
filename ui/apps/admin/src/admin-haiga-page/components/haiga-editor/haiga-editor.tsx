import { useId } from "react";
import { Haiga } from "@kari/shared/models";
import { EditorPage } from "../../../components/editor-page/editor-page";
import { Input } from "../../../components/ui/input";
import { PhotoPicker } from "../../../components/photo-picker/photo-picker";

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
    <EditorPage
      title="Edit haiga"
      onSave={onSave}
      onClose={onClose}
      disableSave={saveDisabled}
    >
      <div className="flex flex-col gap-2">
        {/* The picker is a composite (preview + file input + button), so
            this labels the group rather than pointing at one control. */}
        <span className="text-muted-foreground font-sans text-sm">Image</span>
        <PhotoPicker
          imageFile={imageFile}
          fileName={haiga.image}
          setImageFile={setImageFile}
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
          value={haiga.publisher}
          onChange={(e) => setHaiga({ ...haiga, publisher: e.target.value })}
        />
      </div>
      {/* A haiga carries no lines field, and Save stays off until a picture
          is chosen. Both are explained here, standing on the card in her
          words, BEFORE she goes looking for the missing text box (design
          brief §9, §10) — exactly where `HaigaEditor.png` puts it. */}
      <p className="text-muted-foreground font-sans text-sm">
        The haiku&apos;s words live inside the image itself, so the picture is
        all that&apos;s needed.
      </p>
    </EditorPage>
  );
}
