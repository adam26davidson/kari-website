import { Haiku } from "../../Models";
import "./haikuContent.css";

export function HaikuContent({ haiku }: { haiku: Haiku }) {
  return (
    <>
      <div className="haiku-list-item-lines">
        {haiku.lines.map((line, li) => (
          <div key={li} className="haiku-list-line">
            {line}
          </div>
        ))}
      </div>
      <div className="haiku-list-publisher">{haiku.publisher}</div>
    </>
  );
}
