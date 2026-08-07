import { PhotographyPost } from "../../../../Models";
import "./photography-post-content.css";

const S3_URL = import.meta.env.VITE_S3_URL;

export function PhotographyPostContent({ post }: { post: PhotographyPost }) {
  return (
    <div className="photography-post-content">
      <h2 className="photography-post-header">{post.title}</h2>
      <div className="photography-post-subtitle">{post.subtitle}</div>
      {post.blurb !== "" && (
        <div className="photography-post-blurb">{post.blurb}</div>
      )}
      <div className="photography-post-images">
        {post.images.map((image, idx) => (
          <div key={idx} className="photography-post-image-container">
            <img
              src={S3_URL + "/images/" + image.image}
              alt={image.blurb}
              className="photography-post-image"
            />
            {image.blurb !== "" && (
              <div className="photography-post-image-caption">
                {image.blurb}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
