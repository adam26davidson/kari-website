import { useId } from "react";
import { Haiga } from "@kari/shared/models";
import { EditorPage } from "../../../components/editor-page/editor-page";
import { FieldLabel } from "../../../components/field-label/field-label";
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
  const publisherHintId = useId();
  return (
    <EditorPage
      title="Edit haiga"
      onSave={onSave}
      onClose={onClose}
      disableSave={saveDisabled}
    >
      <div className="flex flex-col gap-2">
        {/* No `htmlFor`: the picker is a composite (preview + file input
            + button), not one control. */}
        <FieldLabel>Image</FieldLabel>
        <PhotoPicker
          imageFile={imageFile}
          fileName={haiga.image}
          setImageFile={setImageFile}
        />
        {/* A haiga carries no lines field, and Save stays off until a picture
            is chosen. Both are explained here, standing on the card in her
            words, BEFORE she goes looking for the missing text box (design
            brief §9, §10).

            It moved up from the foot of the card, where `HaigaEditor.png`
            draws it, to sit with the picture it is about: now that Publisher
            carries its own explanation, a line at the foot would read as
            belonging to Publisher instead (#695). No `aria-describedby` —
            the picker is a composite, with no single control to hang one
            on. */}
        <p className="text-muted-foreground font-sans text-sm">
          The haiku&apos;s words live inside the image itself, so the picture is
          all that&apos;s needed.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {/* "(optional)" because nothing here requires it — Save is gated on
            the image alone — and the photography editor already says so this
            way on its own optional fields. */}
        <FieldLabel htmlFor={publisherId}>Publisher (optional)</FieldLabel>
        <Input
          id={publisherId}
          type="text"
          aria-describedby={publisherHintId}
          value={haiga.publisher}
          onChange={(e) => setHaiga({ ...haiga, publisher: e.target.value })}
        />
        {/* "Publisher" was the one field on this card that named itself and
            nothing else (#695). What she actually puts there is a credit,
            and on a haiga it carries the picture's maker too — "Leaf Haiku
            Journal issue 7, 2025, photo by Reed Davidson". The public Haiga
            page renders it as the muted line under the artwork
            (`haiga-content.tsx`), so the hint says both: what it is for, and
            where it lands. Worded to match the haiku editor's, because the
            two fields are the same field. */}
        <p
          id={publisherHintId}
          className="text-muted-foreground font-sans text-sm"
        >
          Where the haiga was published, and who made the picture — it appears
          under the artwork on the site.
        </p>
      </div>
    </EditorPage>
  );
}
