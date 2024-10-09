import { faArrowDown } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, useEffect } from "react";
import "./haikuZenViewer.css";

interface HaikuZenViewerProps {
  haikuList: string[][];
}

export default function HaikuZenViewer(props: HaikuZenViewerProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showLines, setShowLines] = useState(
    props.haikuList[0].map(() => false)
  );
  const [showNextButton, setShowNextButton] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  const nextHaiku = () => {
    setFadingOut(true);
    setTimeout(() => {
      setFadingOut(false);
      const nextHaiku = (currentIdx + 1) % props.haikuList.length;
      setCurrentIdx(nextHaiku);
      setShowLines(props.haikuList[nextHaiku].map(() => false));
      setShowNextButton(false);
    }, 2000);
  };

  useEffect(() => {
    const timers = props.haikuList[currentIdx].map((_, index) =>
      setTimeout(
        () =>
          setShowLines((prev) => {
            const newShowLines = [...prev];
            newShowLines[index] = true;
            return newShowLines;
          }),
        index * 2000
      )
    );

    timers.push(
      setTimeout(
        () => setShowNextButton(true),
        props.haikuList[currentIdx].length * 2000
      )
    );

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [currentIdx, props.haikuList]);

  return (
    <div className="haiku-zen-container">
      <div className="haiku-zen">
        {props.haikuList[currentIdx].map((line, index) => (
          <div
            key={index}
            className="haiku-zen-line"
            style={{ opacity: showLines[index] && !fadingOut ? 1 : 0 }}
          >
            {line}
          </div>
        ))}
      </div>
      <div className="next-haiku-zen-container">
        <div
          className={"next-haiku-zen"}
          onClick={nextHaiku}
          style={{ opacity: showNextButton && !fadingOut ? 1 : 0 }}
        >
          <FontAwesomeIcon icon={faArrowDown} />
        </div>
      </div>
    </div>
  );
}
