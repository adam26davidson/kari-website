import { PhotographyPost } from "@kari/shared/models";
import { apiImageUrl } from "@kari/shared/utils/image-management-helpers";

/**
 * One row's worth of a photography post: its title, and the strip of
 * thumbnails it holds — `PhotoList.png` / `PhotoListMobile.png`.
 *
 * The title is the row's own markup rather than the shared `TitleLink`, for
 * the reason the haiku and haiga rows dropped `HaikuContent` /
 * `HaigaContent`: that component's `title-link.css` is unlayered shared CSS
 * and would beat anything Tailwind (which is layered) says here. It stays a
 * real `<button>` so clicking the title still opens the editor, and so the
 * page tests and e2e journeys keep finding it by its accessible name.
 *
 * `photography-post-summary-image` is not styling either: it is how the e2e
 * journey checks that an uploaded photo reaches the admin list
 * (e2e/admin-journeys.spec.ts).
 */
export function PhotographyPostSummary({
  post,
  onClick,
}: {
  post: PhotographyPost;
  onClick: (post: PhotographyPost) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <button
        type="button"
        className="text-foreground w-fit max-w-full cursor-pointer text-left font-serif text-[17px] leading-relaxed hover:underline"
        onClick={() => onClick(post)}
      >
        {post.title}
      </button>
      {post.images.length > 0 && (
        <div className="flex flex-row flex-wrap gap-3">
          {post.images.map((img) => (
            <img
              key={img.image}
              className="photography-post-summary-image size-20 shrink-0 rounded-lg object-cover"
              src={apiImageUrl(img.image, "thumb")}
              alt={img.blurb}
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      )}
    </div>
  );
}
