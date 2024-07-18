import { useEffect, useState } from "react";
import "./haiku.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown } from "@fortawesome/free-solid-svg-icons";

const haiku = [
  ["what's left", "of the afternoon", "empty pea pods"],
  ["first cherry blossoms", "a child’s breath", "on the windowpane"],
  ["drifting cherry petals", "for a moment", "we let down our masks"],
];

function Haiku() {
  const [currentHaiku, setCurrentHaiku] = useState(0);
  const [showLines, setShowLines] = useState(haiku[0].map(() => false));
  const [showNextButton, setShowNextButton] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  const nextHaiku = () => {
    setFadingOut(true);
    setTimeout(() => {
      setFadingOut(false);
      const nextHaiku = (currentHaiku + 1) % haiku.length;
      setCurrentHaiku(nextHaiku);
      setShowLines(haiku[nextHaiku].map(() => false));
      setShowNextButton(false);
    }, 2000);
  };

  useEffect(() => {
    const timers = haiku[currentHaiku].map((_, index) =>
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
        haiku[currentHaiku].length * 2000
      )
    );

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [currentHaiku]);

  return (
    <div className="haiku-container">
      <div className="haiku">
        {haiku[currentHaiku].map((line, index) => (
          <div
            key={index}
            className="haiku-line"
            style={{ opacity: showLines[index] && !fadingOut ? 1 : 0 }}
          >
            {line}
          </div>
        ))}
      </div>
      <div className="next-haiku-container">
        <div
          className={"next-haiku"}
          onClick={nextHaiku}
          style={{ opacity: showNextButton && !fadingOut ? 1 : 0 }}
        >
          <FontAwesomeIcon icon={faArrowDown} />
        </div>
      </div>
    </div>
  );
}

export default Haiku;
