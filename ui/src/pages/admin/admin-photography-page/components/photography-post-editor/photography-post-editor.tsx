import { PhotographyPost } from "../../../../../models";
import { AdminItemList } from "../../../../../components/admin-item-list/admin-item-list";
import { DataEditor } from "../../../../../components/data-editor/data-editor";
import { PhotoPicker } from "../../../../../components/photo-picker/photo-picker";
import { moveItemByOne } from "../../../../../utils/data-list-helpers";
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
  const updateField =
    (field: "title" | "subtitle" | "blurb") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setPost({ ...post, [field]: e.target.value });
    };

  const onNewImage = () => {
    setImages([...images, newEditorImage()]);
  };

  const onDelete = (idx: number) => {
    const id = images[idx].id;
    setImages(images.filter((entry) => entry.id !== id));
  };

  const onMove = (idx: number, direction: "up" | "down") => {
    setImages(moveItemByOne(images, idx, direction));
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
    <DataEditor onSave={onSave} onClose={onClose} disableSave={saveDisabled}>
      <div className="photography-post-editor-fields">
        <input
          type="text"
          placeholder="Title"
          aria-label="Title"
          value={post.title}
          onChange={updateField("title")}
        />
        <input
          type="text"
          placeholder="Subtitle"
          aria-label="Subtitle"
          value={post.subtitle}
          onChange={updateField("subtitle")}
        />
        <textarea
          value={post.blurb}
          placeholder={"Optional blurb"}
          aria-label="Optional blurb"
          onChange={updateField("blurb")}
        />
      </div>
      <div className="photography-post-editor-images">
        <AdminItemList
          items={images}
          onNewItem={onNewImage}
          onDelete={onDelete}
          onMove={onMove}
          hideEdit
          renderItem={(entry) => (
            <div className="photography-post-editor-image-fields">
              <PhotoPicker
                imageFile={entry.file}
                fileName={entry.image}
                setImageFile={setImageFile(entry.id)}
              />
              <textarea
                value={entry.blurb}
                placeholder={"image blurb or caption"}
                aria-label="image blurb or caption"
                onChange={handleImageBlurbChange(entry.id)}
              />
            </div>
          )}
        />
      </div>
    </DataEditor>
  );
}
