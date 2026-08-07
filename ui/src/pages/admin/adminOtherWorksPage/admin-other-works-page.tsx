/* eslint-disable react-hooks/exhaustive-deps */
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
  const [imageFiles, setImageFiles] = useState<
    Array<{ file: File; id: string } | null>
  >([]);

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
    setImageFiles([]);
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

  const onAddImage = async (file: File, id: string) => {
    const newImageFiles = [...imageFiles, { file, id }];
    setImageFiles(newImageFiles);
  };

  const saveOpenPost = async () => {
    if (!openPost) return;
    const newPostList = postList.slice();
    const idx = newPostList.findIndex((post) => post.id === openPost.id);
    if (idx === -1) {
      console.error("Post not found");
      return;
    }
    const originalPost = { ...newPostList[idx] };
    newPostList[idx] = { ...openPost };
    if (!(await savePostList(newPostList))) return;

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
       */
      setLoading({
        isLoading: true,
        message: "Updating image visibility...",
      });
      if (originalPost.isPublished !== openPost.isPublished) {
        const urlConverter = openPost.isPublished
          ? changeImageUrlToS3
          : changeImageUrlToApi;
        for (let i = 0; i < originalImages.length; i++) {
          const originalImage = originalImages[i];
          const newImage = Array.from(newImages).find((img) => {
            return img.src === originalImage.src;
          });
          if (newImage) {
            newImage.src = urlConverter(originalImage.src);
            await ImageService.setPublished(
              getImageFileName(originalImage.src) || "",
              openPost.isPublished,
              getAccessTokenSilently,
            );
          }
        }
      }

      //upload images in new that are not in original
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
          const imageId = newImage.title;
          const imageFile = imageFiles.find((img) => img?.id === imageId);
          if (imageFile) {
            const fileName = await ImageService.upload(
              imageFile.file,
              openPost.isPublished,
              getAccessTokenSilently,
            );
            if (!fileName) {
              throw new Error("Failed to upload image");
            }
            newImage.src = baseUrl + fileName;
            // remove image from list
            const updatedImageFiles = imageFiles.filter(
              (img) => img?.id !== imageId,
            );
            setImageFiles(updatedImageFiles);
          }
        }
      }

      // convert the new HTML back to a string
      const newHtmlString = newHtmlDoc.documentElement.outerHTML;

      setLoading({
        isLoading: true,
        message: "Saving other works item content...",
      });
      await BlogService.updateContent(
        openPost.id,
        newHtmlString || "",
        openPost.isPublished,
        getAccessTokenSilently,
      );

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
    } catch (error) {
      console.error(error);
      notify("Failed to save other works item", "error");
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
  };

  const closeOpenPost = () => {
    setOpenPost(null);
    setOpenPostContent(null);
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
