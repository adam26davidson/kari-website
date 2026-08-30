import { useEffect, useState } from "react";
import "./admin-haiku-page.css";
import "../admin.css";
import { v4 as uuidv4 } from "uuid";
import { useNavigate, useParams } from "react-router";
import { Haiku } from "@kari/shared/models";
import { HaikuContent } from "@kari/shared/components/haiku-content/haiku-content";
import { HaikuService } from "@kari/shared/services/haiku";
import {
  moveItemByIdByOne,
  removeItemById,
} from "@kari/shared/utils/data-list-helpers";
import { HaikuEditor } from "./components/haiku-editor/haiku-editor";
import { LoadError } from "@kari/shared/components/load-error/load-error";
import { AdminItemList } from "../components/admin-item-list/admin-item-list";
import { useAdminUi } from "../admin-ui-context";
import { useAdminList } from "../use-admin-list";
import { useListUrls } from "../use-list-urls";
import { useUnsavedChanges } from "../use-unsaved-changes";

const LIST_PATH = "/haiku";

export function AdminHaikuPage() {
  const { confirm } = useAdminUi();
  const { id } = useParams();
  const navigate = useNavigate();
  const { listUrl, itemUrl } = useListUrls(LIST_PATH);
  const {
    list: haikuList,
    loaded,
    loadFailed,
    load,
    saveList,
  } = useAdminList<Haiku>({
    noun: "haiku",
    getList: HaikuService.getListFromApi,
    updateList: HaikuService.updateList,
  });
  const [openHaiku, setOpenHaiku] = useState<Haiku | null>(null);

  // The editor is URL-driven: /admin/haiku/:id opens a copy of that haiku,
  // navigating back to /admin/haiku closes it. An id that isn't in the
  // loaded list (stale link, deleted item) falls back to the list.
  useEffect(() => {
    if (!id) {
      setOpenHaiku(null);
      return;
    }
    if (openHaiku?.id === id || !loaded) return;
    const item = haikuList.find((haiku) => haiku.id === id);
    if (item) {
      setOpenHaiku({ ...item });
    } else {
      navigate(listUrl, { replace: true });
    }
  }, [id, openHaiku, loaded, haikuList, navigate, listUrl]);

  // The open copy is dirty when it differs from its saved list entry;
  // navigating away then requires confirmation.
  const savedHaiku = openHaiku
    ? haikuList.find((haiku) => haiku.id === openHaiku.id)
    : undefined;
  useUnsavedChanges(
    !!openHaiku && JSON.stringify(openHaiku) !== JSON.stringify(savedHaiku),
  );

  const deleteHaiku = async (id: string) => {
    await saveList(removeItemById(haikuList, id), "Haiku deleted");
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
      navigate(itemUrl(newHaiku.id));
    }
  };

  const onDelete = (id: string) => {
    confirm("Are you sure you want to delete this haiku?", () =>
      deleteHaiku(id),
    );
  };

  const onMove = async (id: string, direction: "up" | "down") => {
    const newHaikuList = moveItemByIdByOne(haikuList, id, direction);
    await saveList(newHaikuList, "Order updated");
  };

  const onEdit = (id: string) => {
    navigate(itemUrl(id));
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

  if (loadFailed) {
    return <LoadError message="Failed to load haiku." onRetry={load} />;
  }

  return openHaiku ? (
    <HaikuEditor
      haiku={openHaiku}
      setHaiku={setOpenHaiku}
      saveDisabled={
        openHaiku.lines.length === 0 || openHaiku.lines[0].length === 0
      }
      onSave={saveOpenHaiku}
      onClose={() => navigate(listUrl)}
    />
  ) : (
    <AdminItemList
      items={haikuList}
      // Matches the sidebar link, so the page says which section she is in.
      title="Haiku"
      noun="haiku"
      addLabel="Add a haiku"
      getSearchText={(haiku) => [...haiku.lines, haiku.publisher].join(" ")}
      compact={true}
      onNewItem={onNewItem}
      onEdit={onEdit}
      onDelete={onDelete}
      onMove={onMove}
      renderItem={(haiku) => <HaikuContent haiku={haiku} compact={true} />}
    />
  );
}
