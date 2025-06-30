import { BlogPost } from "../../Models";
import { TitleLink } from "../title-link/title-link";
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
      <TitleLink
        href={!isAdmin ? `/blog/${post.id}` : undefined}
        onClick={isAdmin ? () => onClick(post) : undefined}
      >
        {post.title}
      </TitleLink>
      <span>{new Date(post.date).toLocaleDateString()}</span>
      {showPublished && (
        <span className="blog-post-summary-status">
          {post.isPublished ? "Published" : "Draft"}
        </span>
      )}
    </div>
  );
}
