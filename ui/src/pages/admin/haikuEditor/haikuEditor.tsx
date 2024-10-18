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

const HAIKU_ENDPOINT = "http://localhost:3000/haiku";

interface Haiku {
  lines: Array<string>;
}

function HaikuEditor() {
  const { getAccessTokenSilently } = useAuth0();

  const [haikuList, setHaikuList] = useState<Array<Haiku>>([]);
  const [newHaiku, setNewHaiku] = useState("");
  const [addingHaiku, setAddingHaiku] = useState(false);
  //const [loading, setLoading] = useState(false);

  const updateHaikus = async () => {
    //setLoading(true);
    const token = await getAccessTokenSilently();
    const response = await fetch(HAIKU_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(haikuList),
    });
    console.log(response);
    //setLoading(false);
  };

  // on page load, get the haikus
  useEffect(() => {
    const getHaikus = async () => {
      //setLoading(true);
      const token = await getAccessTokenSilently();
      const response = await fetch("http://localhost:3000/haiku", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data: Array<Haiku> = await response.json();
      console.log(data);
      setHaikuList(data);
      //setLoading(false);
    };
    getHaikus();
  }, [getAccessTokenSilently]);

  const deleteHaiku = (haikuIdx: number) => () => {
    const newHaikuList = haikuList.slice();
    newHaikuList.splice(haikuIdx, 1);
    updateHaikus();
    setHaikuList(newHaikuList);
  };

  const moveHaiku =
    (haikuIdx: number, haiku: Haiku, direction: "up" | "down") => () => {
      if (haikuIdx === 0 && direction === "up") return;
      if (haikuIdx === haikuList.length - 1 && direction === "down") return;

      const newHaikuList = haikuList.slice();
      newHaikuList.splice(haikuIdx, 1);
      const offset = direction === "up" ? -1 : 1;
      newHaikuList.splice(haikuIdx + offset, 0, haiku);
      updateHaikus();
      setHaikuList(newHaikuList);
      return;
    };

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
              updateHaikus();
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
          {haikuList.map((currentHaiku, haikuIdx) => (
            <div key={haikuIdx} className="admin-haiku-list-item">
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
                  onClick={moveHaiku(haikuIdx, currentHaiku, "up")}
                >
                  <FontAwesomeIcon icon={faArrowUp} />
                </div>
                <div
                  className="admin-icon-button"
                  onClick={moveHaiku(haikuIdx, currentHaiku, "down")}
                >
                  <FontAwesomeIcon icon={faArrowDown} />
                </div>
                <div
                  className="admin-icon-button"
                  onClick={deleteHaiku(haikuIdx)}
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
