import { useEffect, useState } from "react";
import "../admin.css";
import { v4 as uuidv4 } from "uuid";
import { useNavigate, useParams } from "react-router-dom";
import { PhotographyPost } from "../../../models";
import {
  moveItemByIdByOne,
  removeItemById,
} from "../../../utils/data-list-helpers";
import { ImageService } from "../../../services/images";
import { PhotographyService } from "../../../services/photography";
import { PhotographyPostEditor } from "./components/photography-post-editor/photography-post-editor";
import {
  EditorImage,
  newEditorImage,
} from "./components/photography-post-editor/editor-image";
import { PhotographyPostSummary } from "./components/photography-post-summary/photography-post-summary";
import { LoadError } from "../../../components/load-error/load-error";
import { AdminItemList } from "../components/admin-item-list/admin-item-list";
import { useAdminToken } from "../../../hooks/use-admin-token";
import { useAdminUi } from "../admin-ui-context";
import { useAdminList } from "../use-admin-list";
import { useUnsavedChanges } from "../use-unsaved-changes";

const LIST_PATH = "/admin/photography";

/** Copies a post deeply enough that edits to the copy never leak back. */
const copyPost = (post: PhotographyPost): PhotographyPost => ({
  ...post,
  images: post.images.map((image) => ({ ...image })),
});

export function AdminPhotographyPage() {
  const getAccessTokenSilently = useAdminToken();
  const { showLoading, hideLoading, confirm, notify } = useAdminUi();
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    list: postList,
    loaded,
    loadFailed,
    load,
    saveList,
  } = useAdminList<PhotographyPost>({
    noun: "photography posts",
    getList: PhotographyService.getListFromApi,
    updateList: PhotographyService.updateList,
  });
  const [openPost, setOpenPost] = useState<PhotographyPost | null>(null);
  // While a post is open in the editor, its images (plus any pending files)
  // live here as id-keyed entries — the single source of truth for the image
  // list. openPost.images is only the as-opened snapshot; saveOpenPost
  // rebuilds the saved images from these entries.
  const [editorImages, setEditorImages] = useState<Array<EditorImage>>([]);

  // The editor is URL-driven: /admin/photography/:id opens a copy of that
  // post, navigating back to /admin/photography closes it. An id that isn't
  // in the loaded list (stale link, deleted item) falls back to the list.
  useEffect(() => {
    if (!id) {
      setOpenPost(null);
      setEditorImages([]);
      return;
    }
    if (openPost?.id === id || !loaded) return;
    const item = postList.find((post) => post.id === id);
    if (item) {
      const openItem = copyPost(item);
      setEditorImages(
        openItem.images.map((image) =>
          newEditorImage(image.image, image.blurb),
        ),
      );
      setOpenPost(openItem);
    } else {
      navigate(LIST_PATH, { replace: true });
    }
  }, [id, openPost, loaded, postList, navigate]);

  // Dirty when the open copy's fields differ from the saved list entry, or
  // the editor's image entries differ from the saved images (reorder,
  // add/remove, blurb edit, or a picked file awaiting upload).
  const savedPost = openPost
    ? postList.find((post) => post.id === openPost.id)
    : undefined;
  const editorImagesDirty =
    !!openPost &&
    (editorImages.some((entry) => entry.file) ||
      JSON.stringify(
        editorImages.map(({ image, blurb }) => ({ image, blurb })),
      ) !== JSON.stringify(savedPost?.images));
  const navigateWithoutGuard = useUnsavedChanges(
    !!openPost &&
      (editorImagesDirty ||
        JSON.stringify(openPost) !== JSON.stringify(savedPost)),
  );

  const deletePost = async (id: string) => {
    // The post's image objects are deliberately NOT deleted: they may
    // still be referenced by other content (e.g. as the site background),
    // and if not, the image-cleanup sweep collects them later.
    await saveList(removeItemById(postList, id), "Photography post deleted");
  };

  // List display functions ---------------------------------------------------

  const onNewItem = () => {
    confirm(
      "This will create a new empty photography post which you can then edit. Do you want to continue?",
      () => createNewPost(),
    );
  };

  const createNewPost = async () => {
    const newPost: PhotographyPost = {
      id: uuidv4(),
      title: "",
      subtitle: "",
      blurb: "",
      images: [],
    };

    showLoading("Creating new photography post...");

    const newPostList = [...postList, copyPost(newPost)];
    if (await saveList(newPostList, "New photography post created")) {
      navigate(`${LIST_PATH}/${newPost.id}`);
    }
  };

  const onDelete = (id: string) => {
    confirm("Are you sure you want to delete this photography post?", () =>
      deletePost(id),
    );
  };

  const onMove = async (id: string, direction: "up" | "down") => {
    const newPostList = moveItemByIdByOne(postList, id, direction);
    await saveList(newPostList, "Order updated");
  };

  const onEdit = (id: string) => {
    navigate(`${LIST_PATH}/${id}`);
  };

  // Editor functions ---------------------------------------------------------

  const saveOpenPost = async () => {
    if (!openPost) return;
    const newPostList = postList.slice();
    const idx = newPostList.findIndex((post) => post.id === openPost.id);
    if (idx === -1) {
      console.error("Post not found");
      return;
    }

    const originalPost = copyPost(newPostList[idx]);

    // Upload images in the new post that are not in the original,
    // building fresh image objects instead of mutating the open post's
    // React state in place. The list is only written after the uploads
    // have succeeded, so a failure at any step leaves the published post
    // intact.
    const editedPost = copyPost(openPost);
    try {
      showLoading("Uploading images...");
      editedPost.images = [];
      for (const entry of editorImages) {
        const newImage = { image: entry.image, blurb: entry.blurb };
        const isInOriginal = originalPost.images.some((img) => {
          return img.image === newImage.image;
        });
        if (!isInOriginal && entry.file) {
          // image was not in original and must be added
          const fileName = await ImageService.upload(
            entry.file,
            true,
            getAccessTokenSilently,
          );
          if (!fileName) {
            throw new Error("Failed to upload image");
          }
          newImage.image = fileName;
        }
        editedPost.images.push(newImage);
      }
    } catch (error) {
      console.error(error);
      notify("Failed to save photography post images", "error");
      hideLoading();
      return;
    }

    // save the post list. Images removed from the post are deliberately
    // NOT deleted from storage: they may still be referenced by other
    // content (e.g. as the site background), and if not, the
    // image-cleanup sweep collects them later.
    newPostList[idx] = editedPost;
    if (!(await saveList(newPostList, "Photography post saved"))) return;
    // The dirty flag still reflects the pre-save state until the next
    // render, so close the editor via the guard bypass.
    navigateWithoutGuard(LIST_PATH);
  };

  const closeOpenPost = () => {
    navigate(LIST_PATH);
  };

  if (loadFailed) {
    return (
      <LoadError message="Failed to load photography posts." onRetry={load} />
    );
  }

  return openPost ? (
    <PhotographyPostEditor
      post={openPost}
      setPost={setOpenPost}
      saveDisabled={openPost.title.length === 0}
      onSave={saveOpenPost}
      onClose={closeOpenPost}
      images={editorImages}
      setImages={setEditorImages}
    />
  ) : (
    <AdminItemList
      items={postList}
      noun="photography posts"
      getSearchText={(post) =>
        [
          post.title,
          post.subtitle,
          post.blurb,
          ...post.images.map((image) => image.blurb),
        ].join(" ")
      }
      onNewItem={onNewItem}
      onEdit={onEdit}
      onDelete={onDelete}
      onMove={onMove}
      renderItem={(post) => (
        <PhotographyPostSummary post={post} onClick={() => onEdit(post.id)} />
      )}
    />
  );
}
