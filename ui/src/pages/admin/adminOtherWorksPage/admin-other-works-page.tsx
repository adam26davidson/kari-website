import { useEffect, useState } from "react";
import "./admin-other-works-page.css";
import "../admin.css";
import { useAdminToken } from "../../../hooks/useAdminToken";
import { Confirmation, Loading, Notify } from "../admin";
import DataList from "../../../components/dataList/dataList";
import { v4 as uuidv4 } from "uuid";
import { BlogPost } from "../../../Models";
import DataListItem from "../../../components/dataListItem/dataListItem";
import { moveItemByOne } from "../../../utils/data-list-helpers";
import { BlogService } from "../../../services/blog";
import { BlogPostSummary } from "../../../components/blog-post-summary/blog-post-summary";
import { BlogPostEditor } from "./components/blog-post-editor/blog-post-editor";
import { ImageService } from "../../../services/images";
import {
  changeImageUrlToApi,
  changeImageUrlToS3,
  getImageFileName,
} from "../../../utils/image-management-helpers";
import { HttpError } from "../../../services/http-error";
import { LoadError } from "../../../components/load-error/load-error";

const S3_URL = import.meta.env.VITE_S3_URL;
const API_URL = import.meta.env.VITE_API_URL;

// Shown when a failed publish/unpublish could not fully restore the
// previous state; storage stays mixed until the same save is retried.
const ROLLBACK_INCOMPLETE_MESSAGE =
  "Save failed and rolling back was incomplete — some content or images " +
  "may have the wrong visibility. Save again to retry.";

interface AdminOtherWorksPageProps {
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
  notify: Notify;
}

export function AdminOtherWorksPage({
  setLoading,
  setConfirmation,
  notify,
}: AdminOtherWorksPageProps) {
  const getAccessTokenSilently = useAdminToken();
  const [postList, setPostList] = useState<Array<BlogPost>>([]);
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

  const [loadFailed, setLoadFailed] = useState(false);

  const load = async () => {
    setLoading({ isLoading: true, message: "Loading other works..." });
    setLoadFailed(false);
    try {
      const data = await BlogService.getListFromApi(getAccessTokenSilently);
      setPostList(data);
    } catch (error) {
      // Never show an empty editable list after a failed load — saving it
      // would overwrite the real data.
      console.error(error);
      setLoadFailed(true);
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toasts on error always; toasts success only when a message is given, so
  // multi-step flows can notify once at the end.
  const savePostList = async (
    newPostList: Array<BlogPost>,
    successMessage?: string,
  ): Promise<boolean> => {
    setLoading({ isLoading: true, message: "Updating other works..." });
    try {
      await BlogService.updateList(newPostList, getAccessTokenSilently);
      setPostList(newPostList);
      if (successMessage) {
        notify(successMessage);
      }
      return true;
    } catch (error) {
      console.error(error);
      notify("Failed to save — your change was not saved", "error");
      return false;
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
  };

  const deletePost = (idx: number) => async () => {
    const postToDelete = postList[idx];
    if (!postToDelete) {
      console.error("Post not found");
      return;
    }
    setLoading({
      isLoading: true,
      message: "Deleting other works item...",
    });

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
        setLoading({ isLoading: false, message: "" });
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
    setLoading({
      isLoading: true,
      message: "Deleting other works item images...",
    });
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
    setLoading({ isLoading: false, message: "" });
  };

  // List display functions ---------------------------------------------------

  const onNewItem = async () => {
    setConfirmation({
      show: true,
      message:
        "This will create a new empty other works item which you can then edit. Do you want to continue?",
      options: [
        {
          label: "Yes",
          callback: () => createNewPost(),
        },
        {
          label: "No",
          callback: () => {},
        },
      ],
    });
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
    setLoading({
      isLoading: true,
      message: "Creating new other works item...",
    });
    try {
      await BlogService.updateContent(id, "", false, getAccessTokenSilently);
    } catch (error) {
      console.error(error);
      notify("Failed to create other works item", "error");
      return;
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
    notify("New other works item created");
    setPendingImageFiles(new Map());
    setOriginalOpenPostContent("");
    setOpenPostContent("");
    setOpenPost(newPost);
  };

  const onDelete = (idx: number) => () => {
    setConfirmation({
      show: true,
      message: "Are you sure you want to delete this other works item?",
      options: [
        { label: "Yes", callback: () => deletePost(idx)() },
        { label: "No", callback: () => {} },
      ],
    });
  };

  const onMove = (idx: number, direction: "up" | "down") => async () => {
    const newPostList = moveItemByOne(postList, idx, direction);
    await savePostList(newPostList, "Order updated");
  };

  const onEdit = (idx: number) => async () => {
    setLoading({ isLoading: true, message: "Loading content..." });
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
      setLoading({ isLoading: false, message: "" });
    }
  };

  // Editor functions ---------------------------------------------------------

  const onAddImage = (file: File, id: string) => {
    setPendingImageFiles((prev) => new Map(prev).set(id, file));
  };

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
    const publishing = !originalPost.isPublished && openPost.isPublished;
    const unpublishing = originalPost.isPublished && !openPost.isPublished;

    // Set when a rollback could not fully restore the previous state; the
    // final error toast then reports it instead of the generic message.
    let rollbackIncomplete = false;

    // Best-effort flip-back used only on rollback paths. Image visibility
    // is a reversible tag on the same S3 object (no data is moved), so
    // re-flipping restores the previous state exactly; a failure here
    // leaves images half-flipped and is reported loudly, never swallowed.
    const rollBackImageFlips = async (
      fileNames: Array<string>,
      isPublished: boolean,
    ) => {
      for (const fileName of fileNames) {
        try {
          await ImageService.setPublished(
            fileName,
            isPublished,
            getAccessTokenSilently,
          );
        } catch (error) {
          console.error(error);
          rollbackIncomplete = true;
        }
      }
    };

    // Flip each image's visibility one at a time, flipping the already-
    // flipped ones back on a mid-loop failure so no half-migrated image
    // set survives; rethrows the original failure.
    const setImagesPublishedOrRollBack = async (
      fileNames: Array<string>,
      isPublished: boolean,
    ) => {
      const flipped: Array<string> = [];
      try {
        for (const fileName of fileNames) {
          await ImageService.setPublished(
            fileName,
            isPublished,
            getAccessTokenSilently,
          );
          flipped.push(fileName);
        }
      } catch (error) {
        await rollBackImageFlips(flipped, !isPublished);
        throw error;
      }
    };

    try {
      // image upload
      // go through content html
      const newHtmlDoc = new DOMParser().parseFromString(
        openPostContent || "",
        "text/html",
      );
      const originalHtmlDoc = new DOMParser().parseFromString(
        originalOpenPostContent || "",
        "text/html",
      );

      // find all images
      const newImages = newHtmlDoc.querySelectorAll("img");
      const originalImages = originalHtmlDoc.querySelectorAll("img");
      const baseUrl = `${openPost.isPublished ? S3_URL : API_URL}/images/`;

      // Images in the original content but not in the new become
      // unreferenced once the save succeeds. Collect them now, before any
      // src rewriting below — they are only deleted after the content
      // save has succeeded, so a failure at any step leaves the published
      // content intact.
      const removedImageFileNames: Array<string> = [];
      for (let i = 0; i < originalImages.length; i++) {
        const originalImage = originalImages[i];
        const newImage = Array.from(newImages).find((img) => {
          return img.src === originalImage.src;
        });
        if (!newImage) {
          // image is in original but not in new
          const fileName = getImageFileName(originalImage.src);
          if (!fileName) {
            console.error(
              `File name not found for image to delete: ${originalImage.src}`,
            );
            continue;
          }
          removedImageFileNames.push(fileName);
        }
      }

      /**
       * when a post is published, image URLs use the S3 URL
       * when a post is not published, image URLs use the API URL
       *
       * Rewrite the kept images' srcs to the destination host and collect
       * their file names. In-memory only — the actual visibility flips
       * happen below, at the safe point for each direction.
       */
      const keptImageFileNames: Array<string> = [];
      if (publishing || unpublishing) {
        const urlConverter = openPost.isPublished
          ? changeImageUrlToS3
          : changeImageUrlToApi;
        for (let i = 0; i < originalImages.length; i++) {
          const originalImage = originalImages[i];
          const newImage = Array.from(newImages).find((img) => {
            return img.src === originalImage.src;
          });
          if (!newImage) continue;
          const fileName = getImageFileName(originalImage.src);
          newImage.src = urlConverter(originalImage.src);
          if (fileName) {
            keptImageFileNames.push(fileName);
          } else {
            console.error(
              `File name not found for image: ${originalImage.src}`,
            );
          }
        }
      }

      // Upload images in new that are not in original. This happens before
      // anything existing is touched: a failed upload aborts the save with
      // the previous state fully intact (at worst it leaves orphaned
      // uploads for the GC sweep).
      setLoading({
        isLoading: true,
        message: "Uploading images...",
      });
      for (let i = 0; i < newImages.length; i++) {
        const newImage = newImages[i];
        const originalImage = Array.from(originalImages).find((img) => {
          return img.src === newImage.src;
        });
        if (!originalImage) {
          // The img's title carries the stable id its pending file is
          // keyed by, so the file stays attached however the image has
          // been moved around inside the content. The map is not
          // touched here — on a later failure the whole save retries
          // with every pending file still present (a re-upload just
          // leaves an orphan for the GC sweep).
          const pendingFile = pendingImageFiles.get(newImage.title);
          if (pendingFile) {
            const fileName = await ImageService.upload(
              pendingFile,
              openPost.isPublished,
              getAccessTokenSilently,
            );
            if (!fileName) {
              throw new Error("Failed to upload image");
            }
            newImage.src = baseUrl + fileName;
          }
        }
      }

      // convert the new HTML back to a string; serialize only the body
      // fragment so saved content isn't wrapped in
      // <html><head></head><body>…</body></html> (#80)
      const newHtmlString = newHtmlDoc.body.innerHTML;

      // Publishing is committed by the list save, which therefore goes
      // LAST — the public list must never claim a post whose public
      // content and images don't exist yet. Unpublishing flips the list
      // FIRST, hiding the post before any public object changes, and a
      // failure aborts with everything else untouched (#112). A no-flip
      // save orders content before list too, so a content failure can't
      // leave new metadata (title/date) over old content (#135).
      if (unpublishing && !(await savePostList(newPostList))) return;

      if (publishing) {
        // Public images first: this is safe while the post is still a
        // draft, because the editor loads images through the API, which
        // serves them regardless of their public tag.
        setLoading({
          isLoading: true,
          message: "Updating image visibility...",
        });
        await setImagesPublishedOrRollBack(keptImageFileNames, true);

        setLoading({
          isLoading: true,
          message: "Saving other works item content...",
        });
        try {
          await BlogService.updateContent(
            openPost.id,
            newHtmlString || "",
            true,
            getAccessTokenSilently,
          );
        } catch (error) {
          // The draft content object is untouched (this PUT failed), so
          // flipping the images back restores the previous state exactly.
          await rollBackImageFlips(keptImageFileNames, false);
          throw error;
        }

        // Commit point: only now may the list mark the post published.
        if (!(await savePostList(newPostList))) {
          // The public list still says draft; restore the draft content
          // and image visibility so the previous state stays intact.
          // (savePostList already showed its own error toast.)
          setLoading({ isLoading: true, message: "Rolling back..." });
          try {
            await BlogService.updateContent(
              openPost.id,
              originalOpenPostContent || "",
              false,
              getAccessTokenSilently,
            );
          } catch (rollbackError) {
            console.error(rollbackError);
            rollbackIncomplete = true;
          }
          await rollBackImageFlips(keptImageFileNames, false);
          if (rollbackIncomplete) {
            notify(ROLLBACK_INCOMPLETE_MESSAGE, "error");
          }
          return;
        }
      } else {
        setLoading({
          isLoading: true,
          message: "Saving other works item content...",
        });
        try {
          await BlogService.updateContent(
            openPost.id,
            newHtmlString || "",
            openPost.isPublished,
            getAccessTokenSilently,
          );
        } catch (error) {
          if (unpublishing) {
            // The list already says draft, but the published content
            // object is untouched (this PUT failed); restoring the list
            // restores the previous published state exactly.
            try {
              await BlogService.updateList(
                originalPostList,
                getAccessTokenSilently,
              );
              setPostList(originalPostList);
            } catch (rollbackError) {
              console.error(rollbackError);
              rollbackIncomplete = true;
            }
          }
          throw error;
        }

        if (unpublishing) {
          // The post is hidden and its content now uses API URLs, so
          // nothing public references these images any more — make them
          // private. On a mid-loop failure the whole unpublish rolls
          // back: the helper re-publishes the flipped images, then the
          // published content and list are restored.
          setLoading({
            isLoading: true,
            message: "Updating image visibility...",
          });
          try {
            await setImagesPublishedOrRollBack(keptImageFileNames, false);
          } catch (error) {
            setLoading({ isLoading: true, message: "Rolling back..." });
            try {
              await BlogService.updateContent(
                openPost.id,
                originalOpenPostContent || "",
                true,
                getAccessTokenSilently,
              );
              await BlogService.updateList(
                originalPostList,
                getAccessTokenSilently,
              );
              setPostList(originalPostList);
            } catch (rollbackError) {
              console.error(rollbackError);
              rollbackIncomplete = true;
            }
            throw error;
          }
        } else if (!(await savePostList(newPostList))) {
          // No-flip: the content is already saved, so a failed list save
          // leaves the old title/date over the new content — the reverse
          // (new metadata over old content) would misrepresent what the
          // post contains. Saving again retries both. (savePostList
          // already showed its own error toast.)
          return;
        }
      }

      // The saved content no longer references the removed images; a
      // failed delete just leaves an orphan for later cleanup.
      setLoading({
        isLoading: true,
        message: "Deleting images...",
      });
      for (const fileName of removedImageFileNames) {
        await ImageService.delete(fileName, getAccessTokenSilently).catch(
          console.error,
        );
      }

      notify("Other works item saved");
      setOpenPost(null);
      setOpenPostContent(null);
      setPendingImageFiles(new Map());
    } catch (error) {
      console.error(error);
      notify(
        rollbackIncomplete
          ? ROLLBACK_INCOMPLETE_MESSAGE
          : "Failed to save other works item",
        "error",
      );
    } finally {
      setLoading({ isLoading: false, message: "" });
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
      validate={openPostIsValid}
      onSave={saveOpenPost}
      onClose={closeOpenPost}
      setLoading={setLoading}
      onAddImage={onAddImage}
    />
  ) : (
    <DataList isAdmin={true} onNewItem={onNewItem}>
      {postList.map((post, idx) => (
        <DataListItem
          key={post.id}
          isAdmin={true}
          isLast={idx === postList.length - 1}
          isFirst={idx === 0}
          onEdit={onEdit(idx)}
          onDelete={onDelete(idx)}
          onMoveUp={onMove(idx, "up")}
          onMoveDown={onMove(idx, "down")}
        >
          <BlogPostSummary
            post={post}
            showPublished={true}
            isAdmin={true}
            onClick={onEdit(idx)}
          />
        </DataListItem>
      ))}
    </DataList>
  );
}
