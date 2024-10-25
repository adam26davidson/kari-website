/* eslint-disable react-hooks/exhaustive-deps */
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
import { v4 as uuidv4 } from "uuid";
import { Confirmation, Loading } from "../admin";

const HAIKU_ENDPOINT = "http://localhost:3000/haiku";

interface Haiku {
  id: string;
  title: string;
  lines: Array<string>;
  publisher: string;
}

interface HaikuEditorProps {
  isLoading: boolean;
  setLoading: (loading: Loading) => void;
  isConfirming: boolean;
  setConfirmation: (confirmation: Confirmation) => void;
}

function HaikuEditor(props: HaikuEditorProps) {
  const { getAccessTokenSilently } = useAuth0();

  const [haikuList, setHaikuList] = useState<Array<Haiku>>([]);
  const [newHaiku, setNewHaiku] = useState<Haiku>({
    title: "",
    lines: [],
    publisher: "",
    id: "",
  });
  const [addingHaiku, setAddingHaiku] = useState(false);

  // on page load, get the haikus
  useEffect(() => {
    const getHaikus = async () => {
      props.setLoading({ isLoading: true, message: "Loading haiku..." });
      const token = await getAccessTokenSilently();
      const response = await fetch("http://localhost:3000/haiku", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data: Array<Haiku> = await response.json();
      console.log(data);
      setHaikuList(data);
      props.setLoading({ isLoading: false, message: "" });
    };
    getHaikus();
  }, []);

  const updateHaikus = async (newHaikuList: Array<Haiku>) => {
    props.setLoading({ isLoading: true, message: "Updating haiku..." });
    const token = await getAccessTokenSilently();
    const response = await fetch(HAIKU_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newHaikuList),
    });
    const responseBody = await response.json();
    console.log(responseBody);
    props.setLoading({ isLoading: false, message: "" });
  };

  const deleteHaiku = (haikuIdx: number) => () => {
    const newHaikuList = haikuList.slice();
    newHaikuList.splice(haikuIdx, 1);
    updateHaikus(newHaikuList);
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
      updateHaikus(newHaikuList);
      setHaikuList(newHaikuList);
      return;
    };

  const addNewHaiku = () => {
    const newHaikuList = haikuList.slice();
    const updatedHaiku = { ...newHaiku, id: uuidv4() };
    newHaikuList.push(updatedHaiku);
    updateHaikus(newHaikuList);
    setHaikuList(newHaikuList);
    setAddingHaiku(false);
  };

  const cancelNewHaiku = () => {
    setAddingHaiku(false);
  };

  const newHaikuEditor = () => {
    return (
      <div className="admin-haiku-list-item">
        <div className="admin-haiku-list-item-inputs">
          <input
            type="text"
            placeholder="Title"
            value={newHaiku.title}
            onChange={(e) => {
              setNewHaiku({ ...newHaiku, title: e.target.value });
            }}
          />
          <textarea
            value={newHaiku.lines.join("\n")}
            placeholder={"line 1\nline 2\nline 3"}
            onChange={(e) =>
              setNewHaiku({ ...newHaiku, lines: e.target.value.split("\n") })
            }
          />
          <input
            type="text"
            placeholder="Publisher"
            value={newHaiku.publisher}
            onChange={(e) =>
              setNewHaiku({ ...newHaiku, publisher: e.target.value })
            }
          />
        </div>
        <div className="admin-haiku-list-item-controls">
          <div className="admin-icon-button" onClick={addNewHaiku}>
            <FontAwesomeIcon icon={faPlus} />
          </div>
          <div className="admin-icon-button" onClick={cancelNewHaiku}>
            <FontAwesomeIcon icon={faTrash} />
          </div>
        </div>
      </div>
    );
  };

  return (
    !props.isLoading &&
    !props.isConfirming && (
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
                <div className="admin-haiku-list-item-content">
                  <div className="admin-haiku-list-item-lines">
                    {currentHaiku.lines.map((line, li) => (
                      <div key={li} className="admin-haiku-list-line">
                        {line}
                      </div>
                    ))}
                  </div>
                  <div className="admin-haiku-list-publisher">
                    {currentHaiku.publisher}
                  </div>
                </div>
                <div className="admin-haiku-list-item-controls">
                  {haikuIdx != 0 && (
                    <div
                      className="admin-icon-button"
                      onClick={moveHaiku(haikuIdx, currentHaiku, "up")}
                    >
                      <FontAwesomeIcon icon={faArrowUp} />
                    </div>
                  )}
                  {haikuIdx != haikuList.length - 1 && (
                    <div
                      className="admin-icon-button"
                      onClick={moveHaiku(haikuIdx, currentHaiku, "down")}
                    >
                      <FontAwesomeIcon icon={faArrowDown} />
                    </div>
                  )}
                  <div
                    className="admin-icon-button"
                    onClick={() =>
                      props.setConfirmation({
                        show: true,
                        message: "Are you sure you want to delete this haiku?",
                        options: [
                          {
                            label: "Yes",
                            callback: deleteHaiku(haikuIdx),
                          },
                          {
                            label: "No",
                            callback: () => {},
                          },
                        ],
                      })
                    }
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    )
  );
}

export default HaikuEditor;
