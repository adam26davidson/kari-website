import { faArrowPointer } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useId, useState } from "react";
import "./photo-picker.css";
import { AdminButton } from "../admin-button/admin-button";
import { apiImageUrl } from "../../../../utils/image-management-helpers";

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
    <div className="photo-picker">
      <input
        id={inputId}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        hidden
      />
      {(previewUrl || fileName !== "") && (
        <div className="photo-picker-selection">
          <img
            src={previewUrl ?? apiImageUrl(fileName, "thumb")}
            alt="Selected"
            className="photo-picker-image"
            loading="lazy"
            decoding="async"
          />
        </div>
      )}
      <AdminButton htmlFor={inputId}>
        <FontAwesomeIcon icon={faArrowPointer} />
        {imageFile ? "Select Different Image" : "Select Image"}
      </AdminButton>
    </div>
  );
}
