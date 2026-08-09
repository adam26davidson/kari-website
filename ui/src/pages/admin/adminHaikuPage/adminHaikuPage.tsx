import { useState } from "react";
import "./adminHaikuPage.css";
import "../admin.css";
import { v4 as uuidv4 } from "uuid";
import { Haiku } from "../../../Models";
import { HaikuContent } from "../../../components/haikuContent/haikuContent";
import { HaikuService } from "../../../services/haiku";
import { moveItemByOne } from "../../../utils/data-list-helpers";
import { HaikuEditor } from "./components/haiku-editor/haiku-editor";
import { LoadError } from "../../../components/load-error/load-error";
import { AdminItemList } from "../../../components/admin-item-list/admin-item-list";
import { useAdminUi } from "../admin-ui-context";
import { useAdminList } from "../use-admin-list";

function AdminHaikuPage() {
  const { confirm } = useAdminUi();
  const {
    list: haikuList,
    loadFailed,
    load,
    saveList,
  } = useAdminList<Haiku>({
    noun: "haiku",
    getList: HaikuService.getListFromApi,
    updateList: HaikuService.updateList,
  });
  const [openHaiku, setOpenHaiku] = useState<Haiku | null>(null);

  const deleteHaiku = async (idx: number) => {
    const newList = haikuList.slice();
    newList.splice(idx, 1);
    await saveList(newList, "Haiku deleted");
  };

  // List display functions ---------------------------------------------------

  const onNewItem = () => {
    confirm(
      "This will create a new empty haiku which you can edit. Do you want to continue?",
      () => createNewHaiku(),
    );
  };

  const createNewHaiku = async () => {
    const newHaiku: Haiku = { lines: [], publisher: "", id: uuidv4() };
    const newHaikuList = [...haikuList, { ...newHaiku }];
    if (await saveList(newHaikuList, "New haiku created")) {
      setOpenHaiku(newHaiku);
    }
  };

  const onDelete = (idx: number) => {
    confirm("Are you sure you want to delete this haiku?", () =>
      deleteHaiku(idx),
    );
  };

  const onMove = async (idx: number, direction: "up" | "down") => {
    const newHaikuList = moveItemByOne(haikuList, idx, direction);
    await saveList(newHaikuList, "Order updated");
  };

  const onEdit = (idx: number) => {
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
    await saveList(newHaikuList, "Haiku saved");
  };

  const openHaikuIsValid = () => {
    if (!openHaiku) return false;
    return openHaiku.lines.length > 0 && openHaiku.lines[0].length > 0;
  };

  if (loadFailed) {
    return <LoadError message="Failed to load haiku." onRetry={load} />;
  }

  return openHaiku ? (
    <HaikuEditor
      haiku={openHaiku}
      setHaiku={setOpenHaiku}
      validate={openHaikuIsValid}
      onSave={saveOpenHaiku}
      onClose={() => setOpenHaiku(null)}
    />
  ) : (
    <AdminItemList
      items={haikuList}
      compact={true}
      onNewItem={onNewItem}
      onEdit={onEdit}
      onDelete={onDelete}
      onMove={onMove}
      renderItem={(haiku) => <HaikuContent haiku={haiku} compact={true} />}
    />
  );
}

export default AdminHaikuPage;
