import { useIsMobile } from "../../hooks/isMobile";
import { Haiga } from "../../Models";
import "./haigaContent.css";

const S3_URL = import.meta.env.VITE_S3_URL;

export function HaigaContent({
  haiga,
  compact,
}: {
  haiga: Haiga;
  compact?: boolean;
}) {
  const isMobile = useIsMobile();
  // The haiku lines are part of the artwork itself, so they are never
  // rendered as text — the lines field only feeds the image alt when an
  // older haiga happens to have it filled in.
  const altText = haiga.lines.join(", ") || "haiga";
  if (compact) {
    return (
      <div className="haiga-list-item-content-compact">
        <img
          src={`${S3_URL}/images/${haiga.image}`}
          alt={altText}
          className="haiga-list-item-thumbnail"
        />
        <div className="haiga-list-item-compact-text">
          <div className="haiga-list-publisher-compact">{haiga.publisher}</div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div
        className={
          isMobile
            ? "haiga-list-item-content-mobile"
            : "haiga-list-item-content"
        }
      >
        <div
          className={
            isMobile
              ? "haiga-list-item-image-box-mobile"
              : "haiga-list-item-image-box"
          }
        >
          <img
            src={`${S3_URL}/images/${haiga.image}`}
            alt={altText}
            className="haiga-list-item-image"
          />
        </div>
        <div>
          <div className="haiga-list-publisher">{haiga.publisher}</div>
        </div>
      </div>
    </>
  );
}
