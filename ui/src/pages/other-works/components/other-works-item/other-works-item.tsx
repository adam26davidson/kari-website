import "./other-works-item.css";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BlogService } from "../../../../services/blog";
import { BlogPost as BlogPostData } from "../../../../Models";
import { LoadError } from "../../../../components/load-error/load-error";

export function OtherWorksItem({ id }: { id: string }) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [postContent, setPostContent] = useState<string>("");
  const [post, setPost] = useState<BlogPostData>();

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const newContent = await BlogService.getSanitizedContentFromS3(id || "");
      const postList = await BlogService.getPublicListFromS3();
      const newPost = postList.find((p) => p.id === id);
      setPost(newPost);
      setPostContent(newContent);
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loadFailed) {
    return <LoadError message="Failed to load post." onRetry={load} />;
  }

  return (
    <>
      {!isLoading && (
        <div className="other-works-item">
          <h1>
            <Link className="other-works-item-title-link" to={`/blog/${id}`}>
              {post?.title}
            </Link>
          </h1>
          <div className="other-works-date">
            {new Date(post?.date || "").toLocaleDateString()}
          </div>
          <div
            className="other-works-item-content"
            dangerouslySetInnerHTML={{ __html: postContent }}
          ></div>
        </div>
      )}
    </>
  );
}
