import { PhotographyPost } from "../../../../../Models";
import { DataEditor } from "../../../../../components/data-editor/data-editor";
import DataList from "../../../../../components/dataList/dataList";
import DataListItem from "../../../../../components/dataListItem/dataListItem";
import { PhotoPicker } from "../../../../../components/photo-picker/photo-picker";
import { moveItemByOne } from "../../../../../utils/data-list-helpers";
import { copyPhotographyPost } from "../../../../../utils/misc-utils";
import "./photography-post-editor.css";

export function PhotographyPostEditor({
  post,
  setPost,
  validate,
  onSave,
  onClose,
  imageFiles,
  setImageFiles,
}: {
  post: PhotographyPost;
  setPost: (post: PhotographyPost) => void;
  validate: (post: PhotographyPost) => boolean;
  onSave: () => void;
  onClose: () => void;
  imageFiles: Array<File | null>;
  setImageFiles: (files: Array<File | null>) => void;
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
    const newPost = copyPhotographyPost(post);
    const newImageFiles = imageFiles.slice();

    newPost.images.push({ image: "", blurb: "" });
    newImageFiles.push(null);

    setPost(newPost);
    setImageFiles(newImageFiles);
  };

  const onDelete = (idx: number) => () => {
    const newFileList = imageFiles.slice();
    const newPost = copyPhotographyPost(post);

    newFileList.splice(idx, 1);
    newPost.images.splice(idx, 1);

    setImageFiles(newFileList);
    setPost(newPost);
  };

  const onMove = (idx: number, direction: "up" | "down") => async () => {
    const newPost = copyPhotographyPost(post);
    newPost.images = moveItemByOne(newPost.images, idx, direction);
    setPost(newPost);
  };

  const handleImageBlurbChange =
    (idx: number) => (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newPost = copyPhotographyPost(post);
      newPost.images[idx].blurb = e.target.value;
      setPost(newPost);
    };

  const setImageFile = (idx: number) => (file: File | null) => {
    //if there was a file that is being replaced delete it
    const newFileList = imageFiles.slice();
    const newPost = copyPhotographyPost(post);
    console.log(idx);
    if (file !== null) {
      newFileList[idx] = file;
      newPost.images[idx].image = "";
    } else {
      newFileList[idx] = null;
    }
    console.log(newFileList);
    console.log(newPost.images);
    setPost(newPost);
    setImageFiles(newFileList);
  };

  return (
    <DataEditor onSave={onSave} onClose={onClose} disableSave={!validate(post)}>
      <div className="photography-post-editor-fields">
        <input
          type="text"
          placeholder="Title"
          value={post.title}
          onChange={handleTitleChange}
        />
        <input
          type="text"
          placeholder="Subtitle"
          value={post.subtitle}
          onChange={handleSubtitleChange}
        />
        <textarea
          value={post.blurb}
          placeholder={"Optional blurb"}
          onChange={handleBlurbChange}
        />
      </div>
      <div className="photography-post-editor-images">
        <DataList isAdmin={true} onNewItem={onNewImage}>
          {post.images.map((image, idx) => (
            <DataListItem
              key={idx}
              isAdmin={true}
              isLast={idx === post.images.length - 1}
              isFirst={idx === 0}
              onDelete={onDelete(idx)}
              onMoveUp={onMove(idx, "up")}
              onMoveDown={onMove(idx, "down")}
              hideEdit
            >
              <div className="photography-post-editor-image-fields">
                <PhotoPicker
                  imageFile={imageFiles[idx]}
                  fileName={image.image}
                  setImageFile={setImageFile(idx)}
                />
                <textarea
                  value={image.blurb}
                  placeholder={"image blurb or caption"}
                  onChange={handleImageBlurbChange(idx)}
                />
              </div>
            </DataListItem>
          ))}
        </DataList>
      </div>
    </DataEditor>
  );
}
