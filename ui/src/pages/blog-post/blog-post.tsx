import "./blog-post.css";
import { useParams } from "react-router-dom";
import { ContentPage } from "../../components/content-page/content-page";
import { useEffect, useState } from "react";
import { BlogService } from "../../services/blog";
import { BlogPost as BlogPostData } from "../../Models";

export function BlogPost() {
  const { id } = useParams();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [postContent, setPostContent] = useState<string>("");
  const [post, setPost] = useState<BlogPostData>();

  useEffect(() => {
    // get haiku from s3
    const getHaiku = async () => {
      setIsLoading(true);
      const newContent = await BlogService.getSanitizedContentFromS3(id || "");
      const postList = await BlogService.getPublicListFromS3();
      console.log(postList);
      const newPost = postList.find((p) => p.id === id);
      console.log(newPost);
      setPost(newPost);
      setPostContent(newContent);
      setIsLoading(false);
    };
    getHaiku();
  }, [id]);

  return (
    <ContentPage isLoading={isLoading}>
      <div className="blog-post-page">
        <h1>{post?.title}</h1>
        <div>{new Date(post?.date || "").toLocaleDateString()}</div>
        <div dangerouslySetInnerHTML={{ __html: postContent }}></div>
      </div>
    </ContentPage>
  );
}
