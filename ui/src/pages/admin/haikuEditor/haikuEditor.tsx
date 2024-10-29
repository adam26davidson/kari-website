/* eslint-disable react-hooks/exhaustive-deps */
import { useState } from "react";
import "./haikuEditor.css";
import "../admin.css";
import { useAuth0 } from "@auth0/auth0-react";
import { Confirmation, Loading } from "../admin";
import EditorList from "../../../components/editorList/editorList";

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

  const loadHaiku = async () => {
    const token = await getAccessTokenSilently();
    const response = await fetch(HAIKU_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data: Array<Haiku> = await response.json();
    console.log(data);
    setHaikuList(data);
  };

  const saveHaiku = async (newHaikuList: Array<Haiku>) => {
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

  const newHaikuEditor = () => {
    return (
      <>
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
      </>
    );
  };

  const haikuContent = (idx: number) => {
    return (
      <>
        <div className="admin-haiku-list-item-lines">
          {haikuList[idx].lines.map((line, li) => (
            <div key={li} className="admin-haiku-list-line">
              {line}
            </div>
          ))}
        </div>
        <div className="admin-haiku-list-publisher">
          {haikuList[idx].publisher}
        </div>
      </>
    );
  };

  return (
    <EditorList<Haiku>
      dataList={haikuList}
      newItem={newHaiku}
      isLoading={props.isLoading}
      isConfirming={props.isConfirming}
      setDataList={setHaikuList}
      setLoading={props.setLoading}
      setConfirmation={props.setConfirmation}
      loadData={loadHaiku}
      saveData={saveHaiku}
      itemEditor={newHaikuEditor}
      itemContent={haikuContent}
    />
  );
}

export default HaikuEditor;
