import "./other-works-item.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BlogService } from "../../../../services/blog";
import { BlogPost as BlogPostData } from "../../../../models";
import { LoadError } from "../../../../components/load-error/load-error";
import { formatPostDate } from "../../../../utils/date-helpers";
import { fallBackToLegacyS3Image } from "../../../../utils/image-management-helpers";

export function OtherWorksItem({ id }: { id: string }) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [postContent, setPostContent] = useState<string>("");
  const [post, setPost] = useState<BlogPostData>();
  const contentRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    setNotFound(false);
    try {
      // Resolve the id against the published list first: an unknown or
      // unpublished id is "not found" (no retry will help), whereas a
      // fetch failure below is an error state with retry.
      const postList = await BlogService.getPublicListFromS3();
      const newPost = postList.find((p) => p.id === id);
      if (!newPost) {
        setNotFound(true);
        return;
      }
      const newContent = await BlogService.getSanitizedContentFromS3(id);
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

  // A published post's images are injected HTML, so there is no per-<img>
  // onError to attach: catch their load failures here instead and retry at
  // the pre-migration key, the same fallback the site's React-rendered
  // images get. `error` does not bubble, hence the capture phase.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const onError = (event: Event) => {
      if (event.target instanceof HTMLImageElement) {
        fallBackToLegacyS3Image(event.target);
      }
    };
    container.addEventListener("error", onError, true);
    return () => container.removeEventListener("error", onError, true);
  }, [postContent]);

  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (loadFailed) {
    return <LoadError message="Failed to load post." onRetry={load} />;
  }

  if (notFound || !post) {
    return (
      <div className="other-works-item other-works-item-not-found">
        <h1>Post not found</h1>
        <p>
          This post doesn&apos;t exist or is no longer available.{" "}
          <Link to="/other-works">Back to all posts</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="other-works-item">
      <h1>
        <Link className="other-works-item-title-link" to={`/blog/${id}`}>
          {post.title}
        </Link>
      </h1>
      <div className="other-works-date">
        {formatPostDate(post.date)}
      </div>
      <div
        ref={contentRef}
        className="other-works-item-content"
        dangerouslySetInnerHTML={{ __html: postContent }}
      ></div>
    </div>
  );
}
