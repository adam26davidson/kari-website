import { PhotographyPost } from "../../../../../Models";
import { AdminItemList } from "../../../../../components/admin-item-list/admin-item-list";
import { DataEditor } from "../../../../../components/data-editor/data-editor";
import { PhotoPicker } from "../../../../../components/photo-picker/photo-picker";
import { moveItemByOne } from "../../../../../utils/data-list-helpers";
import { copyPhotographyPost } from "../../../../../utils/misc-utils";
import { EditorImage, newEditorImage } from "./editor-image";
import "./photography-post-editor.css";

export function PhotographyPostEditor({
  post,
  setPost,
  validate,
  onSave,
  onClose,
  images,
  setImages,
}: {
  post: PhotographyPost;
  setPost: (post: PhotographyPost) => void;
  validate: (post: PhotographyPost) => boolean;
  onSave: () => void;
  onClose: () => void;
  images: Array<EditorImage>;
  setImages: (images: Array<EditorImage>) => void;
}) {
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPost = copyPhotographyPost(post);
    newPost.title = e.target.value;
    setPost(newPost);
  };

  const handleSubtitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPost = copyPhotographyPost(post);
    newPost.subtitle = e.target.value;
    setPost(newPost);
  };

  const handleBlurbChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newPost = copyPhotographyPost(post);
    newPost.blurb = e.target.value;
    setPost(newPost);
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
    <DataEditor onSave={onSave} onClose={onClose} disableSave={!validate(post)}>
      <div className="photography-post-editor-fields">
        <input
          type="text"
          placeholder="Title"
          aria-label="Title"
          value={post.title}
          onChange={handleTitleChange}
        />
        <input
          type="text"
          placeholder="Subtitle"
          aria-label="Subtitle"
          value={post.subtitle}
          onChange={handleSubtitleChange}
        />
        <textarea
          value={post.blurb}
          placeholder={"Optional blurb"}
          aria-label="Optional blurb"
          onChange={handleBlurbChange}
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
