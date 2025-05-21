/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import "./admin-blog-page.css";
import "../admin.css";
import { useAuth0 } from "@auth0/auth0-react";
import { Confirmation, Loading } from "../admin";
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

const S3_URL = import.meta.env.VITE_S3_URL;
const API_URL = import.meta.env.VITE_API_URL;

interface AdminBlogPageProps {
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
}

export function AdminBlogPage({
  setLoading,
  setConfirmation,
}: AdminBlogPageProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [postList, setPostList] = useState<Array<BlogPost>>([]);
  const [openPost, setOpenPost] = useState<BlogPost | null>(null);
  const [openPostContent, setOpenPostContent] = useState<string | null>(null);
  const [originalOpenPostContent, setOriginalOpenPostContent] = useState<
    string | null
  >(null);
  const [imageFiles, setImageFiles] = useState<
    Array<{ file: File; id: string } | null>
  >([]);

  useEffect(() => {
    const load = async () => {
      setLoading({ isLoading: true, message: "Loading blog posts..." });
      const data = await BlogService.getListFromApi(getAccessTokenSilently);
      setPostList(data);
      setLoading({ isLoading: false, message: "" });
    };
    load();
  }, []);

  const savePostList = async (newPostList: Array<BlogPost>) => {
    setLoading({ isLoading: true, message: "Updating blog posts..." });
    await BlogService.updateList(newPostList, getAccessTokenSilently);
    setPostList(newPostList);
    setLoading({ isLoading: false, message: "" });
  };

  const deletePost = (idx: number) => async () => {
    const postToDelete = postList[idx];
    if (!postToDelete) {
      console.error("Post not found");
      return;
    }
    setLoading({ isLoading: true, message: "Deleting blog post images..." });

    // first get the content of the post
    const content = await BlogService.getContent(
      postToDelete.id,
      getAccessTokenSilently,
    );

    // then parse the content to find all images and delete them
    const htmlDoc = new DOMParser().parseFromString(content, "text/html");
    const images = htmlDoc.querySelectorAll("img");
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const fileName = getImageFileName(image.src);
      if (!fileName) {
        console.error(`File name not found for image: ${image.src}`);
        continue;
      }
      await ImageService.delete(fileName, getAccessTokenSilently);
    }

    setLoading({ isLoading: true, message: "Deleting blog post..." });
    // delete the content
    await BlogService.deleteContent(postToDelete.id, getAccessTokenSilently);

    // delete the post
    const newList = postList.slice();
    newList.splice(idx, 1);
    await savePostList(newList);
  };

  // List display functions ---------------------------------------------------

  const onNewItem = async () => {
    setConfirmation({
      show: true,
      message:
        "This will create a new empty blog post which you can then edit. Do you want to continue?",
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
    await savePostList(newPostList);
    setLoading({ isLoading: true, message: "Creating new blog post..." });
    await BlogService.updateContent(id, "", false, getAccessTokenSilently);
    setLoading({ isLoading: false, message: "" });
    setImageFiles([]);
    setOriginalOpenPostContent("");
    setOpenPostContent("");
    setOpenPost(newPost);
  };

  const onDelete = (idx: number) => () => {
    setConfirmation({
      show: true,
      message: "Are you sure you want to delete this blog post?",
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
    setLoading({ isLoading: true, message: "Loading content..." });
    const openItem = { ...postList[idx] };
    const content = await BlogService.getContent(
      openItem.id,
      getAccessTokenSilently,
    );
    setOriginalOpenPostContent(content);
    setOpenPostContent(content);
    setLoading({ isLoading: false, message: "" });
    setOpenPost(openItem);
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
    await savePostList(newPostList);

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

    // delete images that are in the original but not in the new
    setLoading({
      isLoading: true,
      message: "Deleting images...",
    });
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
        await ImageService.delete(fileName, getAccessTokenSilently);
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
            console.error("Failed to upload image");
            return;
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
      message: "Saving blog post content...",
    });
    await BlogService.updateContent(
      openPost.id,
      newHtmlString || "",
      openPost.isPublished,
      getAccessTokenSilently,
    );
    setLoading({ isLoading: false, message: "" });
    setOpenPost(null);
    setOpenPostContent(null);
  };

  const closeOpenPost = () => {
    setOpenPost(null);
    setOpenPostContent(null);
  };

  const openPostIsValid = () => {
    if (!openPost) return false;
    return openPost.title.length > 0;
  };

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
