import "./other-works-item.css";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BlogService } from "../../../../services/blog";
import { BlogPost as BlogPostData } from "../../../../Models";

export function OtherWorksItem({ id }: { id: string }) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [postContent, setPostContent] = useState<string>("");
  const [post, setPost] = useState<BlogPostData>();

  useEffect(() => {
    const getOtherWorksItem = async () => {
      setIsLoading(true);
      const newContent = await BlogService.getSanitizedContentFromS3(id || "");
      const postList = await BlogService.getPublicListFromS3();
      const newPost = postList.find((p) => p.id === id);
      setPost(newPost);
      setPostContent(newContent);
      setIsLoading(false);
    };
    getOtherWorksItem();
  }, [id]);

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
