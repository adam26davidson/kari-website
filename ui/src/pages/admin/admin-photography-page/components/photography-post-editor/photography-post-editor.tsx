import { useId } from "react";
import { PhotographyPost } from "../../../../../models";
import { AdminItemList } from "../../../components/admin-item-list/admin-item-list";
import { DataEditor } from "../../../components/data-editor/data-editor";
import { PhotoPicker } from "../../../components/photo-picker/photo-picker";
import {
  moveItemByIdByOne,
  removeItemById,
} from "../../../../../utils/data-list-helpers";
import { EditorImage, newEditorImage } from "./editor-image";
import "./photography-post-editor.css";

export function PhotographyPostEditor({
  post,
  setPost,
  saveDisabled,
  onSave,
  onClose,
  images,
  setImages,
}: {
  post: PhotographyPost;
  setPost: (post: PhotographyPost) => void;
  saveDisabled: boolean;
  onSave: () => void;
  onClose: () => void;
  images: Array<EditorImage>;
  setImages: (images: Array<EditorImage>) => void;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const blurbId = useId();
  const captionIdPrefix = useId();
  const updateField =
    (field: "title" | "subtitle" | "blurb") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setPost({ ...post, [field]: e.target.value });
    };

  const onNewImage = () => {
    setImages([...images, newEditorImage()]);
  };

  const onDelete = (id: string) => {
    setImages(removeItemById(images, id));
  };

  const onMove = (id: string, direction: "up" | "down") => {
    setImages(moveItemByIdByOne(images, id, direction));
  };

  const handleImageBlurbChange =
    (id: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setImages(
        images.map((entry) =>
          entry.id === id ? { ...entry, blurb: e.target.value } : entry,
        ),
      );
    };

  const setImageFile = (id: string) => (file: File | null) => {
    setImages(
      images.map((entry) => {
        if (entry.id !== id) return entry;
        // A newly picked file replaces whatever was stored; clearing the
        // stored name marks the entry as pending upload.
        return file !== null
          ? { ...entry, file, image: "" }
          : { ...entry, file: null };
      }),
    );
  };

  return (
    <DataEditor
      title="Edit photography post"
      onSave={onSave}
      onClose={onClose}
      disableSave={saveDisabled}
    >
      <div className="photography-post-editor-fields">
        <div className="admin-field">
          <label className="admin-field-label" htmlFor={titleId}>
            Title
          </label>
          <input
            id={titleId}
            type="text"
            value={post.title}
            onChange={updateField("title")}
          />
        </div>
        <div className="admin-field">
          <label className="admin-field-label" htmlFor={subtitleId}>
            Subtitle
          </label>
          <input
            id={subtitleId}
            type="text"
            value={post.subtitle}
            onChange={updateField("subtitle")}
          />
        </div>
        <div className="admin-field">
          <label className="admin-field-label" htmlFor={blurbId}>
            Blurb (optional)
          </label>
          <textarea
            id={blurbId}
            value={post.blurb}
            onChange={updateField("blurb")}
          />
        </div>
      </div>
      <div className="photography-post-editor-images">
        <AdminItemList
          items={images}
          addLabel="Add an image"
          // Secondary: Save, in the header above, is this screen's one
          // primary. Filled, these two competed as equals (#457).
          addVariant="secondary"
          onNewItem={onNewImage}
          onDelete={onDelete}
          onMove={onMove}
          hideEdit
          renderItem={(entry) => (
            <div className="photography-post-editor-image-fields">
              <div className="admin-field photography-post-editor-photo-field">
                {/* Group label: the picker is a composite, not one
                    control, so there is nothing to point `for` at. */}
                <span className="admin-field-label">Photo</span>
                <PhotoPicker
                  imageFile={entry.file}
                  fileName={entry.image}
                  setImageFile={setImageFile(entry.id)}
                />
              </div>
              <div className="admin-field photography-post-editor-caption-field">
                <label
                  className="admin-field-label"
                  htmlFor={`${captionIdPrefix}-${entry.id}`}
                >
                  Caption (optional)
                </label>
                <textarea
                  id={`${captionIdPrefix}-${entry.id}`}
                  value={entry.blurb}
                  onChange={handleImageBlurbChange(entry.id)}
                />
              </div>
            </div>
          )}
        />
      </div>
    </DataEditor>
  );
}
