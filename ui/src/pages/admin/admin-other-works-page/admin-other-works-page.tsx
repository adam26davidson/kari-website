import { useState } from "react";
import "./admin-other-works-page.css";
import "../admin.css";
import { v4 as uuidv4 } from "uuid";
import { BlogPost } from "../../../models";
import { moveItemByOne } from "../../../utils/data-list-helpers";
import { BlogService } from "../../../services/blog";
import { BlogPostSummary } from "../../../components/blog-post-summary/blog-post-summary";
import { BlogPostEditor } from "./components/blog-post-editor/blog-post-editor";
import { ImageService } from "../../../services/images";
import { getImageFileName } from "../../../utils/image-management-helpers";
import { HttpError } from "../../../services/http-error";
import { LoadError } from "../../../components/load-error/load-error";
import { AdminItemList } from "../../../components/admin-item-list/admin-item-list";
import { useAdminToken } from "../../../hooks/use-admin-token";
import { useAdminUi } from "../admin-ui-context";
import { useAdminList } from "../use-admin-list";
import { saveBlogPost } from "./blog-post-save";

export function AdminOtherWorksPage() {
  const getAccessTokenSilently = useAdminToken();
  const { showLoading, hideLoading, confirm, notify } = useAdminUi();
  const {
    list: postList,
    setList: setPostList,
    loadFailed,
    load,
    saveList: savePostList,
  } = useAdminList<BlogPost>({
    noun: "other works",
    getList: BlogService.getListFromApi,
    updateList: BlogService.updateList,
  });
  const [openPost, setOpenPost] = useState<BlogPost | null>(null);
  const [openPostContent, setOpenPostContent] = useState<string | null>(null);
  const [originalOpenPostContent, setOriginalOpenPostContent] = useState<
    string | null
  >(null);
  // Freshly picked files awaiting upload, keyed by the stable client-side
  // id the editor stamps on the img's title attribute at pick time. The
  // images themselves live inside the Tiptap HTML content, so this
  // id-keyed map — not a parallel index-aligned array — is what ties each
  // pending file to its img node: moving an image around in the content
  // moves its id with it, and the file follows (#134). Entries are only
  // cleared once a save fully succeeds, so a failed save can be retried
  // with every pending file still attached.
  const [pendingImageFiles, setPendingImageFiles] = useState<Map<string, File>>(
    new Map(),
  );

  const deletePost = async (idx: number) => {
    const postToDelete = postList[idx];
    if (!postToDelete) {
      console.error("Post not found");
      return;
    }
    showLoading("Deleting other works item...");

    // First get the content of the post so its images can be cleaned up
    // once the delete has succeeded; content that was never created (404)
    // is fine to delete, any other fetch failure aborts the delete.
    let content = "";
    try {
      content = await BlogService.getContent(
        postToDelete.id,
        getAccessTokenSilently,
      );
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) {
        console.error(error);
        notify("Failed to delete other works item", "error");
        hideLoading();
        return;
      }
    }

    // Save the shortened list first — if this fails the item stays fully
    // intact and referenced.
    const newList = postList.slice();
    newList.splice(idx, 1);
    if (!(await savePostList(newList, "Other works item deleted"))) return;

    // The saved list no longer references the item, so its content and
    // images can go; a failed delete just leaves orphans for later
    // cleanup.
    showLoading("Deleting other works item images...");
    const htmlDoc = new DOMParser().parseFromString(content, "text/html");
    const images = htmlDoc.querySelectorAll("img");
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const fileName = getImageFileName(image.src);
      if (!fileName) {
        console.error(`File name not found for image: ${image.src}`);
        continue;
      }
      await ImageService.delete(fileName, getAccessTokenSilently).catch(
        console.error,
      );
    }
    await BlogService.deleteContent(
      postToDelete.id,
      getAccessTokenSilently,
    ).catch(console.error);
    hideLoading();
  };

  // List display functions ---------------------------------------------------

  const onNewItem = () => {
    confirm(
      "This will create a new empty other works item which you can then edit. Do you want to continue?",
      () => createNewPost(),
    );
  };

  const createNewPost = async () => {
    const id = uuidv4();
    const newPost: BlogPost = {
      id,
      title: "",
      date: new Date().toISOString(),
      isPublished: false,
    };
    const newPostList = [...postList, { ...newPost }];
    if (!(await savePostList(newPostList))) return;
    showLoading("Creating new other works item...");
    try {
      await BlogService.updateContent(id, "", false, getAccessTokenSilently);
    } catch (error) {
      console.error(error);
      notify("Failed to create other works item", "error");
      return;
    } finally {
      hideLoading();
    }
    notify("New other works item created");
    setPendingImageFiles(new Map());
    setOriginalOpenPostContent("");
    setOpenPostContent("");
    setOpenPost(newPost);
  };

  const onDelete = (idx: number) => {
    confirm("Are you sure you want to delete this other works item?", () =>
      deletePost(idx),
    );
  };

  const onMove = async (idx: number, direction: "up" | "down") => {
    const newPostList = moveItemByOne(postList, idx, direction);
    await savePostList(newPostList, "Order updated");
  };

  const onEdit = async (idx: number) => {
    showLoading("Loading content...");
    const openItem = { ...postList[idx] };
    try {
      const content = await BlogService.getContent(
        openItem.id,
        getAccessTokenSilently,
      );
      setPendingImageFiles(new Map());
      setOriginalOpenPostContent(content);
      setOpenPostContent(content);
      setOpenPost(openItem);
    } catch (error) {
      // Never open the editor with missing content — saving it would
      // overwrite the real content.
      console.error(error);
      notify("Failed to load content", "error");
    } finally {
      hideLoading();
    }
  };

  // Editor functions ---------------------------------------------------------

  const onAddImage = (file: File, id: string) => {
    setPendingImageFiles((prev) => new Map(prev).set(id, file));
  };

  // The save itself — image diffing, uploads, and the publish/unpublish/
  // no-flip transaction with its rollbacks — lives in blog-post-save.ts;
  // this wrapper only wires the page's state and services into it and
  // closes the editor when the save fully succeeds.
  const saveOpenPost = async () => {
    if (!openPost) return;
    const originalPostList = postList;
    const newPostList = postList.slice();
    const idx = newPostList.findIndex((post) => post.id === openPost.id);
    if (idx === -1) {
      console.error("Post not found");
      return;
    }
    const originalPost = { ...newPostList[idx] };
    newPostList[idx] = { ...openPost };

    try {
      const result = await saveBlogPost({
        post: openPost,
        wasPublished: originalPost.isPublished,
        newPostList,
        originalContent: originalOpenPostContent,
        newContent: openPostContent,
        pendingImageFiles,
        deps: {
          getToken: getAccessTokenSilently,
          updateContent: BlogService.updateContent,
          uploadImage: ImageService.upload,
          deleteImage: ImageService.delete,
          setImagePublished: ImageService.setPublished,
          saveList: savePostList,
          restoreList: async () => {
            await BlogService.updateList(
              originalPostList,
              getAccessTokenSilently,
            );
            setPostList(originalPostList);
          },
          showLoading,
          notify,
        },
      });
      if (result.outcome === "saved") {
        setOpenPost(null);
        setOpenPostContent(null);
        setPendingImageFiles(new Map());
      }
    } finally {
      hideLoading();
    }
  };

  const closeOpenPost = () => {
    setOpenPost(null);
    setOpenPostContent(null);
    setPendingImageFiles(new Map());
  };

  const openPostIsValid = () => {
    if (!openPost) return false;
    return openPost.title.length > 0;
  };

  if (loadFailed) {
    return <LoadError message="Failed to load other works." onRetry={load} />;
  }

  return openPost ? (
    <BlogPostEditor
      post={openPost}
      content={openPostContent}
      setContent={setOpenPostContent}
      setPost={setOpenPost}
      saveDisabled={!openPostIsValid()}
      onSave={saveOpenPost}
      onClose={closeOpenPost}
      onAddImage={onAddImage}
    />
  ) : (
    <AdminItemList
      items={postList}
      onNewItem={onNewItem}
      onEdit={onEdit}
      onDelete={onDelete}
      onMove={onMove}
      renderItem={(post, idx) => (
        <BlogPostSummary
          post={post}
          showPublished={true}
          isAdmin={true}
          onClick={() => onEdit(idx)}
        />
      )}
    />
  );
}
