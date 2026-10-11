import "./other-works-item.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { BlogService } from "@kari/shared/services/blog";
import { BlogPost as BlogPostData } from "@kari/shared/models";
import { LoadError } from "@kari/shared/components/load-error/load-error";
import { formatPostDate } from "@kari/shared/utils/date-helpers";
import { sanitizeHtml } from "@kari/shared/utils/sanitize-html";
import { usePreviewOverrides } from "../../../../preview/preview-overrides-context";

export function OtherWorksItem({ id }: { id: string }) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [postContent, setPostContent] = useState<string>("");
  const [post, setPost] = useState<BlogPostData>();

  // The admin's unsaved copy of THIS post, when the page is framed by her
  // editor's site preview (#859). The draft is the page: it renders at once
  // and never gives way to loading, not-found or a failed fetch, as on the
  // home page. That includes the published check below — a new post is
  // unpublished from creation, and the pane must show her the post before
  // she decides to publish it. Safe because only the admin's own
  // same-origin frame can deliver a draft (preview-overrides-provider).
  const { blogPost: draft } = usePreviewOverrides();
  const previewing = draft !== undefined && draft.id === id;
  const draftContent = draft?.content;
  // Through the same sanitizer as content read from S3: the draft is raw
  // editor HTML, and this must not become the one way unsanitized HTML
  // reaches the page.
  const sanitizedDraftContent = useMemo(
    () => (previewing ? sanitizeHtml(draftContent ?? "") : ""),
    [previewing, draftContent],
  );

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

  if (previewing) {
    return (
      <PostBody
        id={id}
        title={draft.title}
        date={draft.date}
        html={sanitizedDraftContent}
      />
    );
  }

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
    <PostBody id={id} title={post.title} date={post.date} html={postContent} />
  );
}

/** One post as the page shows it; `html` must already be sanitized. */
function PostBody({
  id,
  title,
  date,
  html,
}: {
  id: string;
  title: string;
  date: string;
  html: string;
}) {
  return (
    <div className="other-works-item">
      <h1>
        <Link className="other-works-item-title-link" to={`/blog/${id}`}>
          {title}
        </Link>
      </h1>
      <div className="other-works-date">{formatPostDate(date)}</div>
      <div
        className="other-works-item-content"
        dangerouslySetInnerHTML={{ __html: html }}
      ></div>
    </div>
  );
}
