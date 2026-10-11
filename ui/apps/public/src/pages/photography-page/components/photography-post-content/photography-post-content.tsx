import { useMemo } from "react";
import { PhotographyPost } from "@kari/shared/models";
import { PhotographyPostOverride } from "@kari/shared/utils/preview-channel";
import { useObjectUrls } from "@kari/shared/hooks/use-object-urls";
import { s3ImageUrl } from "@kari/shared/utils/image-management-helpers";
import "./photography-post-content.css";

export function PhotographyPostContent({
  post,
}: {
  post: PhotographyPost | PhotographyPostOverride;
}) {
  // In the admin's site preview (#859) any row may carry a photo she has
  // picked but not uploaded. Memoised on the images array — useObjectUrls
  // re-runs on the array's identity, and a fresh .map per render would
  // loop it.
  const files = useMemo(
    () => post.images.map((image) => ("file" in image ? image.file : null)),
    [post.images],
  );
  const draftUrls = useObjectUrls(files);

  return (
    <div className="photography-post-content">
      <h2 className="photography-post-header">{post.title}</h2>
      <div className="photography-post-subtitle">{post.subtitle}</div>
      {post.blurb !== "" && (
        <div className="photography-post-blurb">{post.blurb}</div>
      )}
      <div className="photography-post-images">
        {post.images.map((image, idx) => {
          const src =
            draftUrls[idx] ?? (image.image ? s3ImageUrl(image.image) : "");
          return (
            <div key={idx} className="photography-post-image-container">
              {/* A row she has added but not picked a photo for yet: its
                  caption, and no broken image. */}
              {src && (
                <img
                  src={src}
                  alt={image.blurb}
                  className="photography-post-image"
                />
              )}
              {image.blurb !== "" && (
                <div className="photography-post-image-caption">
                  {image.blurb}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
