/* eslint-disable react-hooks/exhaustive-deps */
import { useState } from "react";
import "./haigaEditor.css";
import { Confirmation, Loading } from "../admin";
import { useAuth0 } from "@auth0/auth0-react";
import EditorList from "../../../components/editorList/editorList";

const HAIGA_ENDPOINT = "http://localhost:3000/haiga";

interface Haiga {
  id: string;
  title: string;
  lines: Array<string>;
  image: string;
  publisher: string;
}

interface HaigaEditorProps {
  isLoading: boolean;
  setLoading: (loading: Loading) => void;
  isConfirming: boolean;
  setConfirmation: (confirmation: Confirmation) => void;
}

function HaigaEditor(props: HaigaEditorProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [haigaList, setHaigaList] = useState<Array<Haiga>>([]);
  const [newHaiga, setNewHaiga] = useState<Haiga>({
    title: "",
    lines: [],
    image: "",
    publisher: "",
    id: "",
  });

  const loadHaiga = async () => {
    const token = await getAccessTokenSilently();
    const response = await fetch(HAIGA_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data: Array<Haiga> = await response.json();
    console.log(data);
    setHaigaList(data);
  };

  const saveHaiga = async (newHaigaList: Array<Haiga>) => {
    props.setLoading({ isLoading: true, message: "Updating haiga..." });
    const token = await getAccessTokenSilently();
    const response = await fetch(HAIGA_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newHaigaList),
    });
    const responseBody = await response.json();
    console.log(responseBody);
    props.setLoading({ isLoading: false, message: "" });
  };

  const newHaigaEditor = () => {
    return (
      <>
        <input
          type="text"
          placeholder="Title"
          value={newHaiga.title}
          onChange={(e) => {
            setNewHaiga({ ...newHaiga, title: e.target.value });
          }}
        />
        <textarea
          value={newHaiga.lines.join("\n")}
          placeholder={"line 1\nline 2\nline 3"}
          onChange={(e) =>
            setNewHaiga({ ...newHaiga, lines: e.target.value.split("\n") })
          }
        />
        <input
          type="text"
          placeholder="Publisher"
          value={newHaiga.publisher}
          onChange={(e) =>
            setNewHaiga({ ...newHaiga, publisher: e.target.value })
          }
        />
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            if (e.target.files === null) return;
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
              setNewHaiga({ ...newHaiga, image: reader.result as string });
            };
            reader.readAsDataURL(file);
          }}
        />
      </>
    );
  };

  const haigaContent = (idx: number) => {
    return (
      <>
        <div className="admin-haiga-list-item-lines">
          {haigaList[idx].lines.map((line, li) => (
            <div key={li} className="admin-haiga-list-line">
              {line}
            </div>
          ))}
        </div>
        <div className="admin-haiga-list-publisher">
          {haigaList[idx].publisher}
        </div>
      </>
    );
  };

  return (
    <EditorList<Haiga>
      dataList={haigaList}
      newItem={newHaiga}
      isLoading={props.isLoading}
      isConfirming={props.isConfirming}
      setDataList={setHaigaList}
      setLoading={props.setLoading}
      setConfirmation={props.setConfirmation}
      loadData={loadHaiga}
      saveData={saveHaiga}
      itemEditor={newHaigaEditor}
      itemContent={haigaContent}
    />
  );
}

export default HaigaEditor;
