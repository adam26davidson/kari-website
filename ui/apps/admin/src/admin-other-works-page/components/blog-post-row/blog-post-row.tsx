import { BlogPost } from "@kari/shared/models";
import { formatPostDate } from "@kari/shared/utils/date-helpers";

/**
 * One row's worth of an other-works post: its title, its date, and whether
 * a visitor can read it — `WorksList.png` / `WorksListMobile.png`.
 *
 * The admin's own row rather than the shared `BlogPostSummary`, for the
 * reason the haiku, haiga and photography rows dropped their shared
 * components: `blog-post-summary.css` and `title-link.css` are unlayered
 * shared CSS and would beat anything Tailwind (which is layered) says here.
 * The shared component is untouched and still renders the PUBLIC other-works
 * list, which is also what the public-side e2e journey locates by
 * `.blog-post-summary`.
 *
 * The title is a real `<button>` so clicking it still opens the editor, and
 * so the page tests and the e2e journeys keep finding it by its accessible
 * name.
 *
 * "Published" and "Draft" are load-bearing words, not decoration: the admin
 * e2e journey asserts a row contains one or the other after a save. The
 * badge is a shape as well as a colour — soft green fill for published,
 * a bare hairline for a draft — so the two are told apart by more than hue
 * (design brief §5).
 */
export function BlogPostRow({
  post,
  onClick,
}: {
  post: BlogPost;
  onClick: (post: BlogPost) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        className="text-foreground w-fit max-w-full cursor-pointer text-left font-serif text-[17px] leading-relaxed hover:underline"
        onClick={() => onClick(post)}
      >
        {post.title}
      </button>
      <div className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground font-sans text-sm">
          {formatPostDate(post.date)}
        </span>
        {post.isPublished ? (
          // The boards' `#E3EAE2` on Fir, said as the green it is a tint of
          // rather than as a fourth hex (README, "Supporting values").
          <span className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 font-sans text-xs font-medium">
            Published
          </span>
        ) : (
          <span className="border-border text-muted-foreground rounded-full border px-2.5 py-0.5 font-sans text-xs">
            Draft
          </span>
        )}
      </div>
    </div>
  );
}
