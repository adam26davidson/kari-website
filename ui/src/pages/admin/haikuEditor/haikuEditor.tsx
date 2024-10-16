import { useEffect, useState } from "react";
import "./haikuEditor.css";
import "../admin.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faArrowUp,
  faArrowDown,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth0 } from "@auth0/auth0-react";

interface Haiku {
  lines: Array<string>;
}

function HaikuEditor() {
  const { getAccessTokenSilently } = useAuth0();

  const [haikuList, setHaikuList] = useState<Array<Haiku>>([]);
  const [newHaiku, setNewHaiku] = useState("");
  const [addingHaiku, setAddingHaiku] = useState(false);

  // on page load, get the haikus
  useEffect(() => {
    const getHaikus = async () => {
      const token = await getAccessTokenSilently();
      const response = await fetch("http://localhost:3000/haikus", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data: Array<Haiku> = await response.json();
      console.log(data);
      setHaikuList(data);
    };
    getHaikus();
  }, [getAccessTokenSilently]);

  const newHaikuEditor = () => {
    return (
      <div className="admin-haiku-list-item">
        <div className="admin-haiku-list-item-input">
          <textarea
            value={newHaiku}
            onChange={(e) => setNewHaiku(e.target.value)}
          />
        </div>
        <div className="admin-haiku-list-item-controls">
          <div
            className="admin-icon-button"
            onClick={() => {
              const newHaikuList = haikuList.slice();
              newHaikuList.push({
                lines: newHaiku.split("\n").map((line) => line.trim()),
              });
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
      <div className="admin-haiku-container">
        <div className="admin-haiku-list">
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
            <div key={hi} className="admin-haiku-list-item">
              <div className="admin-haiku-list-item-text">
                {currentHaiku.lines.map((line, li) => (
                  <div key={li} className="haiku-list-line">
                    {line}
                  </div>
                ))}
              </div>
              <div className="admin-haiku-list-item-controls">
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
