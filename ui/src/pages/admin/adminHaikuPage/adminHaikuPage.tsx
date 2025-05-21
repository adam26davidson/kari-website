/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import "./adminHaikuPage.css";
import "../admin.css";
import { useAuth0 } from "@auth0/auth0-react";
import { Confirmation, Loading } from "../admin";
import DataList from "../../../components/dataList/dataList";
import { v4 as uuidv4 } from "uuid";
import { Haiku } from "../../../Models";
import { HaikuContent } from "../../../components/haikuContent/haikuContent";
import { HaikuService } from "../../../services/haiku";
import DataListItem from "../../../components/dataListItem/dataListItem";
import { moveItemByOne } from "../../../utils/data-list-helpers";
import { HaikuEditor } from "./components/haiku-editor/haiku-editor";

interface AdminHaikuPageProps {
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
}

function AdminHaikuPage({ setLoading, setConfirmation }: AdminHaikuPageProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [haikuList, setHaikuList] = useState<Array<Haiku>>([]);
  const [openHaiku, setOpenHaiku] = useState<Haiku | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading({ isLoading: true, message: "Loading haiku..." });
      const data = await HaikuService.getListFromApi(getAccessTokenSilently);
      setHaikuList(data);
      setLoading({ isLoading: false, message: "" });
    };
    load();
  }, []);

  const saveHaikuList = async (newHaikuList: Array<Haiku>) => {
    setLoading({ isLoading: true, message: "Updating haiku..." });
    await HaikuService.updateList(newHaikuList, getAccessTokenSilently);
    setHaikuList(newHaikuList);
    setLoading({ isLoading: false, message: "" });
  };

  const deleteHaiku = (idx: number) => async () => {
    const newList = haikuList.slice();
    newList.splice(idx, 1);
    await saveHaikuList(newList);
  };

  // List display functions ---------------------------------------------------

  const onNewItem = () => {
    setConfirmation({
      show: true,
      message:
        "This will create a new empty haiku which you can edit. Do you want to continue?",
      options: [
        { label: "Yes", callback: () => createNewHaiku() },
        { label: "No", callback: () => {} },
      ],
    });
  };

  const createNewHaiku = async () => {
    const newHaiku: Haiku = { lines: [], publisher: "", id: uuidv4() };
    const newHaikuList = [...haikuList, { ...newHaiku }];
    await saveHaikuList(newHaikuList);
    setOpenHaiku(newHaiku);
  };

  const onDelete = (idx: number) => () => {
    setConfirmation({
      show: true,
      message: "Are you sure you want to delete this haiku?",
      options: [
        { label: "Yes", callback: () => deleteHaiku(idx)() },
        { label: "No", callback: () => {} },
      ],
    });
  };

  const onMove = (idx: number, direction: "up" | "down") => async () => {
    const newHaikuList = moveItemByOne(haikuList, idx, direction);
    await saveHaikuList(newHaikuList);
  };

  const onEdit = (idx: number) => () => {
    const openItem = { ...haikuList[idx] };
    setOpenHaiku(openItem);
  };

  // Editor functions ---------------------------------------------------------

  const saveOpenHaiku = async () => {
    if (!openHaiku) return;
    const newHaikuList = haikuList.slice();
    const idx = newHaikuList.findIndex((haiku) => haiku.id === openHaiku.id);
    if (idx === -1) {
      console.error("Haiku not found");
      return;
    }
    newHaikuList[idx] = { ...openHaiku };
    await saveHaikuList(newHaikuList);
  };

  const openHaikuIsValid = () => {
    if (!openHaiku) return false;
    return openHaiku.lines.length > 0 && openHaiku.lines[0].length > 0;
  };

  return openHaiku ? (
    <HaikuEditor
      haiku={openHaiku}
      setHaiku={setOpenHaiku}
      validate={openHaikuIsValid}
      onSave={saveOpenHaiku}
      onClose={() => setOpenHaiku(null)}
    />
  ) : (
    <DataList isAdmin={true} onNewItem={onNewItem}>
      {haikuList.map((haiku, idx) => (
        <DataListItem
          isAdmin={true}
          isLast={idx === haikuList.length - 1}
          isFirst={idx === 0}
          onEdit={onEdit(idx)}
          onDelete={onDelete(idx)}
          onMoveUp={onMove(idx, "up")}
          onMoveDown={onMove(idx, "down")}
        >
          <HaikuContent haiku={haiku} />
        </DataListItem>
      ))}
    </DataList>
  );
}

export default AdminHaikuPage;
