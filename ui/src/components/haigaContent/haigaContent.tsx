import { useIsMobile } from "../../hooks/isMobile";
import { Haiga } from "../../Models";
import "./haigaContent.css";

const S3_URL = "https://s3.us-east-2.amazonaws.com/karidavidson.com";

export function HaigaContent({
  haigaList,
  idx,
}: {
  haigaList: Array<Haiga>;
  idx: number;
}) {
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
            src={`${S3_URL}/images/${haigaList[idx].image}`}
            alt={haigaList[idx].lines.join(", ")}
            className="haiga-list-item-image"
          />
        </div>
        <div>
          <div className="haiga-list-publisher">{haigaList[idx].publisher}</div>
        </div>
      </div>
    </>
  );
}
