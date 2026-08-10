import { TitleLink } from "../../../../../components/title-link/title-link";
import { PhotographyPost } from "../../../../../models";
import { apiImageUrl } from "../../../../../utils/image-management-helpers";
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
            src={apiImageUrl(img.image)}
            alt={img.blurb}
          />
        ))}
      </div>
    </div>
  );
}
