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
  if (compact) {
    return (
      <div className="haiga-list-item-content-compact">
        <img
          src={`${S3_URL}/images/${haiga.image}`}
          alt={haiga.lines.join(", ")}
          className="haiga-list-item-thumbnail"
        />
        <div className="haiga-list-item-compact-text">
          {haiga.lines.map((line, li) => (
            <div key={li} className="haiga-list-line-compact">
              {line}
            </div>
          ))}
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
            alt={haiga.lines.join(", ")}
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
