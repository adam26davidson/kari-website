import { BlogPost } from "../../models";
import { formatPostDate } from "../../utils/date-helpers";
import { TitleLink } from "../title-link/title-link";
import "./blog-post-summary.css";

/**
 * One published post on the PUBLIC other-works list: its title, linking to
 * the post's permalink, and the day it was written.
 *
 * It used to render the admin's list row as well, through `showPublished`
 * and `isAdmin` props that turned the link into a button and added a
 * Published/Draft line. #237 gave the admin its own row
 * (`admin-other-works-page/components/blog-post-row`), for the reason every
 * other admin list grew one: this component's stylesheet is unlayered
 * shared CSS and beats anything Tailwind says on a migrated page. With the
 * admin gone there was exactly one caller left, passing
 * `showPublished={false} isAdmin={false}` — so the branches those props
 * chose between were unreachable, and they went with them.
 */
export function BlogPostSummary({ post }: { post: BlogPost }) {
  return (
    <div className="blog-post-summary">
      <TitleLink href={`/blog/${post.id}`}>{post.title}</TitleLink>
      <span>{formatPostDate(post.date)}</span>
    </div>
  );
}
