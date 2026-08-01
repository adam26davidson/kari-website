/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import "../admin.css";
import { useAdminToken } from "../../../hooks/useAdminToken";
import { Confirmation, Loading, Notify } from "../admin";
import DataList from "../../../components/dataList/dataList";
import { v4 as uuidv4 } from "uuid";
import { PhotographyPost } from "../../../Models";
import DataListItem from "../../../components/dataListItem/dataListItem";
import { moveItemByOne } from "../../../utils/data-list-helpers";
import { ImageService } from "../../../services/images";
import { PhotographyService } from "../../../services/photography";
import { PhotographyPostEditor } from "./components/photography-post-editor/photography-post-editor";
import { PhotographyPostSummary } from "./components/photography-post-summary/photography-post-summary";
import { copyPhotographyPost } from "../../../utils/misc-utils";
import { LoadError } from "../../../components/load-error/load-error";

interface AdminPhotographyPageProps {
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
  notify: Notify;
}

export function AdminPhotographyPage({
  setLoading,
  setConfirmation,
  notify,
}: AdminPhotographyPageProps) {
  const getAccessTokenSilently = useAdminToken();
  const [postList, setPostList] = useState<Array<PhotographyPost>>([]);
  const [openPost, setOpenPost] = useState<PhotographyPost | null>(null);
  const [imageFiles, setImageFiles] = useState<Array<File | null>>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = async () => {
    setLoading({ isLoading: true, message: "Loading photography posts..." });
    setLoadFailed(false);
    try {
      const data = await PhotographyService.getListFromApi(
        getAccessTokenSilently,
      );
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

  const savePostList = async (
    newPostList: Array<PhotographyPost>,
    successMessage: string,
  ): Promise<boolean> => {
    setLoading({ isLoading: true, message: "Updating photography posts..." });
    try {
      await PhotographyService.updateList(newPostList, getAccessTokenSilently);
      setPostList(newPostList);
      notify(successMessage);
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
      message: "Deleting post images...",
    });

    // delete images; a missing image should not block deleting the post
    for (const image of postToDelete.images) {
      await ImageService.delete(image.image, getAccessTokenSilently).catch(
        console.error,
      );
    }

    // delete the post from the list
    const newList = postList.slice();
    newList.splice(idx, 1);
    await savePostList(newList, "Photography post deleted");
  };

  // List display functions ---------------------------------------------------

  const onNewItem = async () => {
    setConfirmation({
      show: true,
      message:
        "This will create a new empty photography post which you can then edit. Do you want to continue?",
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
    const newPost = new PhotographyPost();
    newPost.id = id;

    setLoading({
      isLoading: true,
      message: "Creating new photography post...",
    });

    const newPostList = [...postList, copyPhotographyPost(newPost)];
    if (await savePostList(newPostList, "New photography post created")) {
      setImageFiles([]);
      setOpenPost(newPost);
    }
  };

  const onDelete = (idx: number) => () => {
    setConfirmation({
      show: true,
      message: "Are you sure you want to delete this photography post?",
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
    const openItem = copyPhotographyPost(postList[idx]);
    setImageFiles(openItem.images.map(() => null));
    setOpenPost(openItem);
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

    const originalPost = copyPhotographyPost(newPostList[idx]);

    try {
      // delete images that are in the original but not in the new
      setLoading({
        isLoading: true,
        message: "Deleting images...",
      });
      for (let i = 0; i < originalPost.images.length; i++) {
        const originalImage = originalPost.images[i].image;
        const newImage = Array.from(openPost.images).find((img) => {
          return img.image === originalImage;
        });
        if (!newImage) {
          // image is in original but not in new; a missing image should not
          // block saving the post
          await ImageService.delete(
            originalImage,
            getAccessTokenSilently,
          ).catch(console.error);
        }
      }

      //upload images in new that are not in original
      setLoading({
        isLoading: true,
        message: "Uploading images...",
      });
      for (let i = 0; i < openPost.images.length; i++) {
        const newImage = openPost.images[i];
        const originalImage = Array.from(originalPost.images).find((img) => {
          return img.image === newImage.image;
        });
        if (!originalImage) {
          //image was not in original and must be added
          const imageFile = imageFiles[i];
          if (imageFile) {
            const fileName = await ImageService.upload(
              imageFile,
              true,
              getAccessTokenSilently,
            );
            if (!fileName) {
              throw new Error("Failed to upload image");
            }
            newImage.image = fileName;
          }
        }
      }
    } catch (error) {
      console.error(error);
      notify("Failed to save photography post images", "error");
      setLoading({ isLoading: false, message: "" });
      return;
    }

    // save the post list
    newPostList[idx] = copyPhotographyPost(openPost);
    if (await savePostList(newPostList, "Photography post saved")) {
      setOpenPost(null);
    }
  };

  const closeOpenPost = () => {
    setOpenPost(null);
    setImageFiles([]);
  };

  const openPostIsValid = () => {
    if (!openPost) return false;
    return openPost.title.length > 0;
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
      validate={openPostIsValid}
      onSave={saveOpenPost}
      onClose={closeOpenPost}
      imageFiles={imageFiles}
      setImageFiles={setImageFiles}
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
          <PhotographyPostSummary post={post} onClick={onEdit(idx)} />
        </DataListItem>
      ))}
    </DataList>
  );
}
