/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import "../admin.css";
import { useAuth0 } from "@auth0/auth0-react";
import { Confirmation, Loading } from "../admin";
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

interface AdminPhotographyPageProps {
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
}

export function AdminPhotographyPage({
  setLoading,
  setConfirmation,
}: AdminPhotographyPageProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [postList, setPostList] = useState<Array<PhotographyPost>>([]);
  const [openPost, setOpenPost] = useState<PhotographyPost | null>(null);
  const [imageFiles, setImageFiles] = useState<Array<File | null>>([]);

  useEffect(() => {
    const load = async () => {
      setLoading({ isLoading: true, message: "Loading photography posts..." });
      const data = await PhotographyService.getListFromApi(
        getAccessTokenSilently,
      );
      setPostList(data);
      setLoading({ isLoading: false, message: "" });
    };
    load();
  }, []);

  const savePostList = async (newPostList: Array<PhotographyPost>) => {
    setLoading({ isLoading: true, message: "Updating photography posts..." });
    await PhotographyService.updateList(newPostList, getAccessTokenSilently);
    setPostList(newPostList);
    setLoading({ isLoading: false, message: "" });
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

    // delete images
    postToDelete.images.forEach(async (image) => {
      await ImageService.delete(image.image, getAccessTokenSilently);
    });

    setLoading({ isLoading: true, message: "Deleting other works item..." });

    // delete the post from the list
    const newList = postList.slice();
    newList.splice(idx, 1);
    await savePostList(newList);
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
    await savePostList(newPostList);

    setLoading({ isLoading: false, message: "" });
    setImageFiles([]);
    setOpenPost(newPost);
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
    await savePostList(newPostList);
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

    // find all images

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
        // image is in original but not in new
        await ImageService.delete(originalImage, getAccessTokenSilently);
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
            console.error("Failed to upload image");
            return;
          }
          newImage.image = fileName;
        }
      }
    }

    // save the post list
    setLoading({
      isLoading: true,
      message: "Saving Phot...",
    });

    newPostList[idx] = copyPhotographyPost(openPost);
    await savePostList(newPostList);

    setLoading({ isLoading: false, message: "" });
    setOpenPost(null);
  };

  const closeOpenPost = () => {
    setOpenPost(null);
    setImageFiles([]);
  };

  const openPostIsValid = () => {
    if (!openPost) return false;
    return openPost.title.length > 0;
  };

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
