import { faArrowPointer } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useId, useState } from "react";
import { AdminButton } from "../admin-button/admin-button";
import { apiImageUrl } from "@kari/shared/utils/image-management-helpers";

export function PhotoPicker({
  imageFile,
  fileName,
  setImageFile,
}: {
  imageFile: File | null;
  fileName: string;
  setImageFile: (file: File | null) => void;
}) {
  const inputId = useId();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [imageFile]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file: File = event.target.files[0];
      setImageFile(file);
    } else {
      setImageFile(null);
    }
  };

  return (
    // The button sits UNDER the photo at every width: that is what every
    // board drawing a picker shows (`HaigaEditor`, `HaigaEditorMobile`,
    // `PhotoEditor`, `Appearance`), and it keeps "Select a different image"
    // attached to the picture it replaces rather than floating beside it.
    //
    // `photo-picker` and `photo-picker-image` below are not styling: they are
    // how the e2e journeys reach the hidden file input and assert that a
    // picked photo previews (e2e/admin-journeys.spec.ts, three sections).
    <div className="photo-picker flex flex-col items-start gap-3">
      <input
        id={inputId}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        hidden
      />
      {(previewUrl || fileName !== "") && (
        <img
          src={previewUrl ?? apiImageUrl(fileName, "thumb")}
          alt="Selected"
          // Whatever shape the photo is, it fits inside this box rather than
          // being cropped or stretched to it — an editor's preview has to
          // show her the picture she is about to publish.
          className="photo-picker-image border-border max-h-40 max-w-full rounded-lg border object-contain sm:max-w-56"
          loading="lazy"
          decoding="async"
        />
      )}
      {/* Secondary: picking a photo is a step towards saving, not the
          screen's primary action — the two used to carry identical
          weight (#457). Sentence case, like every other button in the
          admin ("Add an image", "Preview cleanup"); this one was the last
          in Title Case. */}
      <AdminButton htmlFor={inputId} variant="secondary">
        <FontAwesomeIcon icon={faArrowPointer} />
        {imageFile ? "Select a different image" : "Select an image"}
      </AdminButton>
    </div>
  );
}
