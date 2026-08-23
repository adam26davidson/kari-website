import { useEffect, useRef, useState } from "react";
import "./admin-other-works-page.css";
import "../admin.css";
import { v4 as uuidv4 } from "uuid";
import { useNavigate, useParams } from "react-router-dom";
import { BlogPost } from "../../../models";
import {
  moveItemByIdByOne,
  removeItemById,
} from "../../../utils/data-list-helpers";
import { formatPostDate, todayAsPostDate } from "../../../utils/date-helpers";
import { BlogService } from "../../../services/blog";
import { BlogPostSummary } from "../../../components/blog-post-summary/blog-post-summary";
import { BlogPostEditor } from "./components/blog-post-editor/blog-post-editor";
import { ImageService } from "../../../services/images";
import { LoadError } from "../../../components/load-error/load-error";
import { AdminItemList } from "../components/admin-item-list/admin-item-list";
import { useAdminToken } from "../../../hooks/use-admin-token";
import { useAdminUi } from "../admin-ui-context";
import { useAdminList } from "../use-admin-list";
import { useListUrls } from "../use-list-urls";
import { useUnsavedChanges } from "../use-unsaved-changes";
import { saveBlogPost } from "./blog-post-save";

const LIST_PATH = "/admin/other-works";

export function AdminOtherWorksPage() {
  const getAccessTokenSilently = useAdminToken();
  const { showLoading, hideLoading, confirm, notify } = useAdminUi();
  const { id } = useParams();
  const navigate = useNavigate();
  const { listUrl, itemUrl } = useListUrls(LIST_PATH);
  const {
    list: postList,
    setList: setPostList,
    loaded,
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
  // The id whose content fetch is in flight, so the URL-sync effect below
  // doesn't kick off a second fetch while one is pending.
  const loadingIdRef = useRef<string | null>(null);

  const openPostFromList = async (item: BlogPost) => {
    showLoading("Loading content...");
    try {
      const content = await BlogService.getContent(
        item.id,
        getAccessTokenSilently,
      );
      setPendingImageFiles(new Map());
      setOriginalOpenPostContent(content);
      setOpenPostContent(content);
      setOpenPost({ ...item });
    } catch (error) {
      // Never open the editor with missing content — saving it would
      // overwrite the real content.
      console.error(error);
      notify("Failed to load content", "error");
      navigate(listUrl, { replace: true });
    } finally {
      hideLoading();
    }
  };

  // The editor is URL-driven: /admin/other-works/:id fetches that post's
  // content and opens a copy, navigating back to /admin/other-works closes
  // it. An id that isn't in the loaded list (stale link, deleted item)
  // falls back to the list.
  useEffect(() => {
    if (!id) {
      loadingIdRef.current = null;
      setOpenPost(null);
      setOpenPostContent(null);
      setOriginalOpenPostContent(null);
      setPendingImageFiles(new Map());
      return;
    }
    if (openPost?.id === id || !loaded || loadingIdRef.current === id) return;
    const item = postList.find((post) => post.id === id);
    if (!item) {
      navigate(listUrl, { replace: true });
      return;
    }
    loadingIdRef.current = id;
    openPostFromList(item).finally(() => {
      loadingIdRef.current = null;
    });
    // openPostFromList depends on stable services/context only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, openPost, loaded, postList, navigate, listUrl]);

  // Dirty when the open copy's fields, its content, or its pending image
  // files differ from what is saved.
  const savedPost = openPost
    ? postList.find((post) => post.id === openPost.id)
    : undefined;
  const navigateWithoutGuard = useUnsavedChanges(
    !!openPost &&
      (pendingImageFiles.size > 0 ||
        openPostContent !== originalOpenPostContent ||
        JSON.stringify(openPost) !== JSON.stringify(savedPost)),
  );

  const deletePost = async (id: string) => {
    if (!postList.some((post) => post.id === id)) {
      console.error("Post not found");
      return;
    }
    // Save the shortened list first — if this fails the item stays fully
    // intact and referenced.
    const newList = removeItemById(postList, id);
    if (!(await savePostList(newList, "Other works item deleted"))) return;

    // The saved list no longer references the item, so its content
    // document can go; a failed delete just leaves an orphan. The item's
    // image objects are deliberately NOT deleted: they may still be
    // referenced by other content (e.g. as the site background), and if
    // not, the image-cleanup sweep collects them later.
    showLoading("Deleting other works item content...");
    await BlogService.deleteContent(id, getAccessTokenSilently).catch(
      console.error,
    );
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
      date: todayAsPostDate(),
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
    navigate(itemUrl(newPost.id));
  };

  const onDelete = (id: string) => {
    confirm("Are you sure you want to delete this other works item?", () =>
      deletePost(id),
    );
  };

  const onMove = async (id: string, direction: "up" | "down") => {
    const newPostList = moveItemByIdByOne(postList, id, direction);
    await savePostList(newPostList, "Order updated");
  };

  const onEdit = (id: string) => {
    navigate(itemUrl(id));
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
        // The dirty flag still reflects the pre-save state until the next
        // render, so close the editor via the guard bypass.
        navigateWithoutGuard(listUrl);
      }
    } finally {
      hideLoading();
    }
  };

  const closeOpenPost = () => {
    navigate(listUrl);
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
      noun="other works"
      getSearchText={(post) =>
        // Both the stored ISO date and the localized form the list shows.
        `${post.title} ${post.date} ${formatPostDate(post.date)}`
      }
      onNewItem={onNewItem}
      onEdit={onEdit}
      onDelete={onDelete}
      onMove={onMove}
      renderItem={(post) => (
        <BlogPostSummary
          post={post}
          showPublished={true}
          isAdmin={true}
          onClick={() => onEdit(post.id)}
        />
      )}
    />
  );
}
