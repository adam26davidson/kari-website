import { Haiku } from "../../Models";
import "./haikuContent.css";

export function HaikuContent(props: { haikuList: Array<Haiku>; idx: number }) {
  return (
    <>
      <div className="haiku-list-item-lines">
        {props.haikuList[props.idx].lines.map((line, li) => (
          <div key={li} className="haiku-list-line">
            {line}
          </div>
        ))}
      </div>
      <div className="haiku-list-publisher">
        {props.haikuList[props.idx].publisher}
      </div>
    </>
  );
}
