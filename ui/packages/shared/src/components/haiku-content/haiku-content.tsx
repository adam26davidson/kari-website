import { Haiku } from "../../models";
import "./haiku-content.css";

export function HaikuContent({
  haiku,
  compact,
}: {
  haiku: Haiku;
  compact?: boolean;
}) {
  return (
    <>
      <div className="haiku-list-item-lines">
        {haiku.lines.map((line, li) => (
          <div
            key={li}
            className={compact ? "haiku-list-line-compact" : "haiku-list-line"}
          >
            {line}
          </div>
        ))}
      </div>
      <div
        className={
          compact ? "haiku-list-publisher-compact" : "haiku-list-publisher"
        }
      >
        {haiku.publisher}
      </div>
    </>
  );
}
