import { faArrowPointer } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const API_IMAGE_URL = import.meta.env.VITE_API_URL + "/images";

export function PhotoPicker({
  imageFile,
  fileName,
  handleFileSelect,
}: {
  imageFile: File | null;
  fileName: string;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <input
        id="image-upload"
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        hidden
      />
      {(imageFile || fileName !== "") && (
        <div className="admin-image-upload-selection">
          <span>{imageFile ? imageFile.name : "Uploaded Image"}</span>
          <img
            src={
              imageFile
                ? URL.createObjectURL(imageFile)
                : `${API_IMAGE_URL}/${fileName}`
            }
            alt="Selected"
            className="admin-image-preview"
          />
        </div>
      )}
      <label htmlFor="image-upload" className="admin-image-upload">
        <FontAwesomeIcon icon={faArrowPointer} />
        <div className="spacer"></div>
        {imageFile ? "Select Different Image" : "Select Image"}
      </label>
    </>
  );
}
