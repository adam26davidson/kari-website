import "./haikuList.css";

interface HaikuListProps {
  haikuList: string[][];
}

export default function HaikuList(props: HaikuListProps) {
  return (
    <div className="haiku-list-container">
      {props.haikuList.map((currentHaiku, hi) => (
        <div key={hi} className="haiku-list-item">
          {currentHaiku.map((line, li) => (
            <div key={li} className="haiku-list-line">
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
