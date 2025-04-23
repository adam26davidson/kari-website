/* eslint-disable react-hooks/exhaustive-deps */
import { useState } from "react";
import "./adminHaikuPage.css";
import "../admin.css";
import { useAuth0 } from "@auth0/auth0-react";
import { Confirmation, Loading } from "../admin";
import DataList from "../../../components/dataList/dataList";
import { v4 as uuidv4 } from "uuid";
import { Haiku } from "../../../Models";
import { HaikuContent } from "../../../components/haikuContent/haikuContent";
import { HaikuEditor } from "../../../components/haikuEditor/haikuEditor";

const HAIKU_ENDPOINT = import.meta.env.VITE_API_URL + "/haiku";

interface AdminHaikuPageProps {
  isLoading: boolean;
  setLoading: (loading: Loading) => void;
  isConfirming: boolean;
  setConfirmation: (confirmation: Confirmation) => void;
}

function AdminHaikuPage(props: AdminHaikuPageProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [haikuList, setHaikuList] = useState<Array<Haiku>>([]);
  const [newHaiku, setNewHaiku] = useState<Haiku>({
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

  const saveNewHaiku = async (newHaiku: Haiku) => {
    const newDataList = [...haikuList, { ...newHaiku, id: uuidv4() }];
    await saveHaiku(newDataList);
    setHaikuList(newDataList);
  };

  const deleteHaiku = (idx: number) => async () => {
    const newList = haikuList.slice();
    newList.splice(idx, 1);
    await saveHaiku(newList);
    setHaikuList(newList);
  };

  const newHaikuIsValid = () => {
    return (
      newHaiku.lines.length > 0 &&
      newHaiku.lines[0].length > 0
    );
  };

  return (
    <DataList<Haiku>
      dataList={haikuList}
      isLoading={props.isLoading}
      isAdmin={true}
      itemContent={(idx: number) => (
        <HaikuContent haikuList={haikuList} idx={idx} />
      )}
      adminProps={{
        newItem: newHaiku,
        isConfirming: props.isConfirming,
        setDataList: setHaikuList,
        setLoading: props.setLoading,
        setConfirmation: props.setConfirmation,
        loadData: loadHaiku,
        saveData: saveHaiku,
        saveNewItem: saveNewHaiku,
        deleteItem: deleteHaiku,
        newItemIsValid: newHaikuIsValid,
        itemEditor: () => (
          <HaikuEditor newHaiku={newHaiku} setNewHaiku={setNewHaiku} />
        ),
      }}
    />
  );
}

export default AdminHaikuPage;
