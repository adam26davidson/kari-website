import { useState } from "react";
import "./haikuEditor.css";
import "../admin.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faArrowUp,
  faArrowDown,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";

function HaikuEditor() {
  const [haikuList, setHaikuList] = useState<Array<Array<string>>>([
    ["what's left", "of the afternoon", "empty pea pods"],
    ["first cherry blossoms", "a child’s breath", "on the windowpane"],
    ["drifting cherry petals", "for a moment", "we let down our masks"],
  ]);
  const [newHaiku, setNewHaiku] = useState("");
  const [addingHaiku, setAddingHaiku] = useState(false);

  const newHaikuEditor = () => {
    return (
      <div className="haiku-list-item">
        <div className="haiku-list-item-input">
          <textarea
            value={newHaiku}
            onChange={(e) => setNewHaiku(e.target.value)}
          />
        </div>
        <div className="haiku-list-item-controls">
          <div
            className="admin-icon-button"
            onClick={() => {
              const newHaikuList = haikuList.slice();
              newHaikuList.push(
                newHaiku.split("\n").map((line) => line.trim())
              );
              setHaikuList(newHaikuList);
              setAddingHaiku(false);
            }}
          >
            <FontAwesomeIcon icon={faPlus} />
          </div>
          <div
            className="admin-icon-button"
            onClick={() => {
              setNewHaiku("");
              setAddingHaiku(false);
            }}
          >
            <FontAwesomeIcon icon={faTrash} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="haiku-container">
        <div className="haiku-list">
          {!addingHaiku && (
            <div
              className="admin-icon-button"
              onClick={() => setAddingHaiku(!addingHaiku)}
            >
              <FontAwesomeIcon icon={faPlus} />
            </div>
          )}
          {addingHaiku && newHaikuEditor()}
          {haikuList.map((currentHaiku, hi) => (
            <div key={hi} className="haiku-list-item">
              <div className="haiku-list-item-text">
                {currentHaiku.map((line, li) => (
                  <div key={li} className="haiku-list-line">
                    {line}
                  </div>
                ))}
              </div>
              <div className="haiku-list-item-controls">
                <div
                  className="admin-icon-button"
                  onClick={() => {
                    // Move Haiku Up in the List
                    if (hi === 0) return;
                    const newHaiku = haikuList.slice();
                    newHaiku.splice(hi, 1);
                    newHaiku.splice(hi - 1, 0, currentHaiku);
                    setHaikuList(newHaiku);
                  }}
                >
                  <FontAwesomeIcon icon={faArrowUp} />
                </div>
                <div
                  className="admin-icon-button"
                  onClick={() => {
                    // Move Haiku Down in the List
                    if (hi === haikuList.length - 1) return;
                    const newHaiku = haikuList.slice();
                    newHaiku.splice(hi, 1);
                    newHaiku.splice(hi + 1, 0, currentHaiku);
                    setHaikuList(newHaiku);
                  }}
                >
                  <FontAwesomeIcon icon={faArrowDown} />
                </div>
                <div
                  className="admin-icon-button"
                  onClick={() => {
                    const newHaiku = haikuList.slice();
                    newHaiku.splice(hi, 1);
                    setHaikuList(newHaiku);
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default HaikuEditor;
