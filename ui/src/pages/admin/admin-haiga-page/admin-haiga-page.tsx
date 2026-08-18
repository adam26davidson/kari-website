import { useEffect, useState } from "react";
import "./admin-haiga-page.css";
import { v4 as uuidv4 } from "uuid";
import { useNavigate, useParams } from "react-router-dom";
import { Haiga } from "../../../models";
import { HaigaService } from "../../../services/haiga";
import { ImageService } from "../../../services/images";
import { HaigaEditor } from "./components/haiga-editor/haiga-editor";
import { moveItemByOne } from "../../../utils/data-list-helpers";
import { HaigaContent } from "../../../components/haiga-content/haiga-content";
import { LoadError } from "../../../components/load-error/load-error";
import { AdminItemList } from "../components/admin-item-list/admin-item-list";
import { useAdminToken } from "../../../hooks/use-admin-token";
import { useAdminUi } from "../admin-ui-context";
import { useAdminList } from "../use-admin-list";
import { useUnsavedChanges } from "../use-unsaved-changes";

const LIST_PATH = "/admin/haiga";

export function AdminHaigaPage() {
  const getAccessTokenSilently = useAdminToken();
  const { showLoading, hideLoading, confirm, notify } = useAdminUi();
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    list: haigaList,
    loaded,
    loadFailed,
    load,
    saveList,
  } = useAdminList<Haiga>({
    noun: "haiga",
    getList: HaigaService.getListFromApi,
    updateList: HaigaService.updateList,
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [openHaiga, setOpenHaiga] = useState<Haiga | null>(null);

  // The editor is URL-driven: /admin/haiga/:id opens a copy of that haiga,
  // navigating back to /admin/haiga closes it. An id that isn't in the
  // loaded list (stale link, deleted item) falls back to the list.
  useEffect(() => {
    if (!id) {
      setOpenHaiga(null);
      setImageFile(null);
      return;
    }
    if (openHaiga?.id === id || !loaded) return;
    const item = haigaList.find((haiga) => haiga.id === id);
    if (item) {
      setOpenHaiga({ ...item });
      setImageFile(null);
    } else {
      navigate(LIST_PATH, { replace: true });
    }
  }, [id, openHaiga, loaded, haigaList, navigate]);

  // The open copy is dirty when it differs from its saved list entry or a
  // replacement image has been picked but not saved.
  const savedHaiga = openHaiga
    ? haigaList.find((haiga) => haiga.id === openHaiga.id)
    : undefined;
  useUnsavedChanges(
    !!openHaiga &&
      (imageFile !== null ||
        JSON.stringify(openHaiga) !== JSON.stringify(savedHaiga)),
  );

  const deleteHaiga = async (idx: number) => {
    const haigaToDelete = haigaList[idx];
    if (!haigaToDelete) {
      console.error("Haiga not found");
      return;
    }
    const imageToDelete = haigaToDelete.image;
    const newDataList = haigaList.slice();
    newDataList.splice(idx, 1);
    // Save the shortened list first — if this fails the haiga stays
    // fully intact and referenced.
    if (await saveList(newDataList, "Haiga deleted")) {
      // The saved list no longer references the image; a failed delete
      // just leaves an orphan for later cleanup.
      if (imageToDelete) {
        await deleteImage(imageToDelete).catch(console.error);
      }
    }
  };

  // List display functions ---------------------------------------------------

  const onNewItem = () => {
    confirm(
      "This will create a new empty haiga that you can edit. Do you want to continue?",
      () => createNewHaiga(),
    );
  };

  const createNewHaiga = async () => {
    const newHaiga: Haiga = {
      lines: [],
      publisher: "",
      id: uuidv4(),
      image: "",
    };
    const newHaigaList = [...haigaList, { ...newHaiga }];
    if (await saveList(newHaigaList, "New haiga created")) {
      navigate(`${LIST_PATH}/${newHaiga.id}`);
    }
  };

  const onDelete = (idx: number) => {
    confirm("Are you sure you want to delete this haiga?", () =>
      deleteHaiga(idx),
    );
  };

  const onMove = async (idx: number, direction: "up" | "down") => {
    const newHaigaList = moveItemByOne(haigaList, idx, direction);
    await saveList(newHaigaList, "Order updated");
  };

  const onEdit = (idx: number) => {
    navigate(`${LIST_PATH}/${haigaList[idx].id}`);
  };

  // Editor functions ---------------------------------------------------------

  const uploadImage = async (file: File | null) => {
    showLoading("Uploading image...");
    try {
      return await ImageService.upload(file, true, getAccessTokenSilently);
    } finally {
      hideLoading();
    }
  };

  const deleteImage = async (fileName: string) => {
    showLoading("Deleting image...");
    try {
      await ImageService.delete(fileName, getAccessTokenSilently);
    } finally {
      hideLoading();
    }
  };

  const saveOpenHaiga = async () => {
    if (!openHaiga) return;
    const previousFileName = openHaiga.image;
    let fileName = previousFileName;
    if (imageFile) {
      try {
        // Upload the replacement first — the old image is only deleted
        // after the whole save has succeeded, so a failure at any step
        // leaves the published haiga intact.
        const newFileName = await uploadImage(imageFile);
        if (!newFileName) {
          throw new Error("Failed to upload image");
        }
        fileName = newFileName;
      } catch (error) {
        console.error(error);
        notify("Failed to save haiga image", "error");
        return;
      }
    }
    const editedHaiga: Haiga = { ...openHaiga, image: fileName };
    const newDataList = haigaList.slice();
    const idx = newDataList.findIndex((haiga) => haiga.id === openHaiga.id);
    if (idx === -1) {
      console.error("Haiga not found");
      return;
    }
    newDataList[idx] = editedHaiga;
    if (await saveList(newDataList, "Haiga saved")) {
      setOpenHaiga(editedHaiga);
      setImageFile(null);
      // The save succeeded, so nothing references the old image anymore;
      // a failed delete just leaves an orphan for later cleanup.
      if (previousFileName && previousFileName !== fileName) {
        await deleteImage(previousFileName).catch(console.error);
      }
    }
  };

  if (loadFailed) {
    return <LoadError message="Failed to load haiga." onRetry={load} />;
  }

  return openHaiga ? (
    <HaigaEditor
      haiga={openHaiga}
      setHaiga={setOpenHaiga}
      // The artwork is the content — the haiku lines live inside the image
      // itself, so an image (already saved or freshly picked) is all that's
      // required.
      saveDisabled={openHaiga.image.length === 0 && imageFile === null}
      setImageFile={setImageFile}
      imageFile={imageFile}
      onSave={saveOpenHaiga}
      onClose={() => navigate(LIST_PATH)}
    />
  ) : (
    <AdminItemList
      items={haigaList}
      compact={true}
      onNewItem={onNewItem}
      onEdit={onEdit}
      onDelete={onDelete}
      onMove={onMove}
      renderItem={(haiga) => <HaigaContent haiga={haiga} compact={true} />}
    />
  );
}
