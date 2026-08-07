import { TitleLink } from "../../../../../components/title-link/title-link";
import { PhotographyPost } from "../../../../../Models";
import "./photography-post-summary.css";

const API_IMAGE_URL = import.meta.env.VITE_API_URL + "/images";

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
            src={`${API_IMAGE_URL}/${img.image}`}
          />
        ))}
      </div>
    </div>
  );
}
