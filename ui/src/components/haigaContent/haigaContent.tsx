import { useIsMobile } from "../../hooks/isMobile";
import { Haiga } from "../../Models";
import "./haigaContent.css";

const S3_URL = import.meta.env.VITE_S3_URL;

export function HaigaContent({ haiga }: { haiga: Haiga }) {
  const isMobile = useIsMobile();
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
