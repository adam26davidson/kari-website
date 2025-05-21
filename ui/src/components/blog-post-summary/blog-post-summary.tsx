import { BlogPost } from "../../Models";
import "./blog-post-summary.css";

export function BlogPostSummary({
  post,
  showPublished,
  isAdmin,
  onClick,
}: {
  post: BlogPost;
  showPublished: boolean;
  isAdmin: boolean;
  onClick: (post: BlogPost) => void;
}) {
  return (
    <div className="blog-post-summary">
      {!isAdmin && (
        <a className="blog-post-summary-title" href={`/blog/${post.id}`}>
          {post.title}
        </a>
      )}
      {isAdmin && (
        <div className="blog-post-summary-title" onClick={() => onClick(post)}>
          {post.title}
        </div>
      )}
      <span>{new Date(post.date).toLocaleDateString()}</span>
      {showPublished && (
        <span className="blog-post-summary-status">
          {post.isPublished ? "Published" : "Draft"}
        </span>
      )}
    </div>
  );
}
