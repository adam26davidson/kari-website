import { useIsMobile } from "../../hooks/isMobile";
import { Haiga } from "../../Models";
import "./haigaContent.css";

const S3_URL = "https://s3.us-east-2.amazonaws.com/karidavidson.com";

export function HaigaContent(props: { haigaList: Array<Haiga>; idx: number }) {
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
            src={`${S3_URL}/images/${props.haigaList[props.idx].image}`}
            alt={props.haigaList[props.idx].title}
            className="haiga-list-item-image"
          />
        </div>
        <div>
          <div>
            {props.haigaList[props.idx].lines.map((line, li) => (
              <div key={li} className="haiga-list-line">
                {line}
              </div>
            ))}
          </div>
          <div className="haiga-list-publisher">
            {props.haigaList[props.idx].publisher}
          </div>
        </div>
      </div>
    </>
  );
}
