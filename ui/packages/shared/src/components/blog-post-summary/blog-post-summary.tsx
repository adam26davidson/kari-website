import { BlogPost } from "../../models";
import { formatPostDate } from "../../utils/date-helpers";
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
  onClick?: (post: BlogPost) => void;
}) {
  return (
    <div className="blog-post-summary">
      <TitleLink
        href={!isAdmin ? `/blog/${post.id}` : undefined}
        onClick={isAdmin && onClick ? () => onClick(post) : undefined}
      >
        {post.title}
      </TitleLink>
      <span>{formatPostDate(post.date)}</span>
      {showPublished && (
        <span className="blog-post-summary-status">
          {post.isPublished ? "Published" : "Draft"}
        </span>
      )}
    </div>
  );
}
