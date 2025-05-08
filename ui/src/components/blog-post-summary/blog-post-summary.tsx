import { BlogPost } from "../../Models";
import "./blog-post-summary.css";

export function BlogPostSummary({
  post,
  showPublished,
}: {
  post: BlogPost;
  showPublished: boolean;
}) {
  return (
    <div className="blog-post-summary">
      <a className="blog-post-summary-title" href={`/blog/${post.id}`}>
        {post.title}
      </a>
      <span>{new Date(post.date).toLocaleDateString()}</span>
      {showPublished && (
        <span className="blog-post-summary-status">
          {post.isPublished ? "Published" : "Draft"}
        </span>
      )}
    </div>
  );
}
