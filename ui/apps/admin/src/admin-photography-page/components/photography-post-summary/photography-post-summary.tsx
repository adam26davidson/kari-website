import { TitleLink } from "@kari/shared/components/title-link/title-link";
import { PhotographyPost } from "@kari/shared/models";
import { apiImageUrl } from "@kari/shared/utils/image-management-helpers";
import "./photography-post-summary.css";

export function PhotographyPostSummary({
  post,
  onClick,
}: {
  post: PhotographyPost;
  onClick: (post: PhotographyPost) => void;
}) {
  return (
    <div className="photography-post-summary">
      <TitleLink onClick={() => onClick(post)}>{post.title}</TitleLink>
      <div className="photography-post-summary-images">
        {post.images.map((img) => (
          <img
            key={img.image}
            className="photography-post-summary-image"
            src={apiImageUrl(img.image, "thumb")}
            alt={img.blurb}
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
    </div>
  );
}
