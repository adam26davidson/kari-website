import { faArrowPointer } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useId } from "react";
import "./photo-picker.css";
import { AdminButton } from "../admin-button/admin-button";

const API_IMAGE_URL = import.meta.env.VITE_API_URL + "/images";

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
      {(imageFile || fileName !== "") && (
        <div className="photo-picker-selection">
          {/* <span>{imageFile ? imageFile.name : "Uploaded image"}</span> */}
          <img
            src={
              imageFile
                ? URL.createObjectURL(imageFile)
                : `${API_IMAGE_URL}/${fileName}`
            }
            alt="Selected"
            className="photo-picker-image"
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
