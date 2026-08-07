import { useEffect, useState } from "react";
import "./adminHaigaPage.css";
import { Confirmation, Loading, Notify } from "../admin";
import { useAdminToken } from "../../../hooks/useAdminToken";
import DataList from "../../../components/dataList/dataList";
import { v4 as uuidv4 } from "uuid";
import { Haiga } from "../../../Models";
import { HaigaService } from "../../../services/haiga";
import { ImageService } from "../../../services/images";
import { HaigaEditor } from "./components/haiga-editor/haiga-editor";
import { moveItemByOne } from "../../../utils/data-list-helpers";
import DataListItem from "../../../components/dataListItem/dataListItem";
import { HaigaContent } from "../../../components/haigaContent/haigaContent";
import { LoadError } from "../../../components/load-error/load-error";

interface HaigaEditorProps {
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
  notify: Notify;
}

function AdminHaigaPage({
  setLoading,
  setConfirmation,
  notify,
}: HaigaEditorProps) {
  const getAccessTokenSilently = useAdminToken();
  const [haigaList, setHaigaList] = useState<Array<Haiga>>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [openHaiga, setOpenHaiga] = useState<Haiga | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = async () => {
    setLoading({ isLoading: true, message: "Loading haiga..." });
    setLoadFailed(false);
    try {
      const data = await HaigaService.getListFromApi(getAccessTokenSilently);
      setHaigaList(data);
    } catch (error) {
      // Never show an empty editable list after a failed load — saving it
      // would overwrite the real data.
      console.error(error);
      setLoadFailed(true);
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveHaigaList = async (
    newHaigaList: Array<Haiga>,
    successMessage: string,
  ): Promise<boolean> => {
    setLoading({ isLoading: true, message: "Updating haiga..." });
    try {
      await HaigaService.updateList(newHaigaList, getAccessTokenSilently);
      setHaigaList(newHaigaList);
      notify(successMessage);
      return true;
    } catch (error) {
      console.error(error);
      notify("Failed to save — your change was not saved", "error");
      return false;
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
  };

  const deleteHaiga = (idx: number) => async () => {
    const imageToDelete = haigaList[idx].image;
    const newDataList = haigaList.slice();
    newDataList.splice(idx, 1);
    // Save the shortened list first — if this fails the haiga stays
    // fully intact and referenced.
    if (await saveHaigaList(newDataList, "Haiga deleted")) {
      // The saved list no longer references the image; a failed delete
      // just leaves an orphan for later cleanup.
      if (imageToDelete) {
        await deleteImage(imageToDelete).catch(console.error);
      }
    }
  };

  // List display functions ---------------------------------------------------

  const onNewItem = () => {
    setConfirmation({
      show: true,
      message:
        "This will create a new empty haiga that you can edit. Do you want to continue?",
      options: [
        {
          label: "Yes",
          callback: () => createNewHaiga(),
        },
        {
          label: "No",
          callback: () => {},
        },
      ],
    });
  };

  const createNewHaiga = async () => {
    const newHaiga: Haiga = {
      lines: [],
      publisher: "",
      id: uuidv4(),
      image: "",
    };
    const newHaigaList = [...haigaList, { ...newHaiga }];
    if (await saveHaigaList(newHaigaList, "New haiga created")) {
      setImageFile(null);
      setOpenHaiga(newHaiga);
    }
  };

  const onDelete = (idx: number) => () => {
    setConfirmation({
      show: true,
      message: "Are you sure you want to delete this haiga?",
      options: [
        {
          label: "Yes",
          callback: () => deleteHaiga(idx)(),
        },
        {
          label: "No",
          callback: () => {},
        },
      ],
    });
  };

  const onMove = (idx: number, direction: "up" | "down") => async () => {
    const newHaigaList = moveItemByOne(haigaList, idx, direction);
    await saveHaigaList(newHaigaList, "Order updated");
  };

  const onEdit = (idx: number) => () => {
    // copy the haiga to openHaiga
    // this is to avoid mutating the original haiga
    const openItem = { ...haigaList[idx] };
    setOpenHaiga(openItem);
    setImageFile(null);
  };

  // Editor functions ---------------------------------------------------------

  const uploadImage = async (file: File | null) => {
    setLoading({ isLoading: true, message: "Uploading image..." });
    try {
      return await ImageService.upload(file, true, getAccessTokenSilently);
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
  };

  const deleteImage = async (fileName: string) => {
    setLoading({ isLoading: true, message: "Deleting image..." });
    try {
      await ImageService.delete(fileName, getAccessTokenSilently);
    } finally {
      setLoading({ isLoading: false, message: "" });
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
    if (await saveHaigaList(newDataList, "Haiga saved")) {
      setOpenHaiga(editedHaiga);
      setImageFile(null);
      // The save succeeded, so nothing references the old image anymore;
      // a failed delete just leaves an orphan for later cleanup.
      if (previousFileName && previousFileName !== fileName) {
        await deleteImage(previousFileName).catch(console.error);
      }
    }
  };

  const openHaigaIsValid = () => {
    if (!openHaiga) return false;

    // The artwork is the content — the haiku lines live inside the image
    // itself, so an image (already saved or freshly picked) is all that's
    // required.
    return openHaiga.image.length > 0 || imageFile !== null;
  };

  if (loadFailed) {
    return <LoadError message="Failed to load haiga." onRetry={load} />;
  }

  return openHaiga ? (
    <HaigaEditor
      haiga={openHaiga}
      setHaiga={setOpenHaiga}
      validate={openHaigaIsValid}
      setImageFile={setImageFile}
      imageFile={imageFile}
      onSave={saveOpenHaiga}
      onClose={() => setOpenHaiga(null)}
    />
  ) : (
    <DataList isAdmin={true} onNewItem={onNewItem}>
      {haigaList.map((haiga, idx) => (
        <DataListItem
          key={haiga.id}
          isAdmin={true}
          compact={true}
          isLast={idx === haigaList.length - 1}
          isFirst={idx === 0}
          onEdit={onEdit(idx)}
          onDelete={onDelete(idx)}
          onMoveUp={onMove(idx, "up")}
          onMoveDown={onMove(idx, "down")}
        >
          <HaigaContent haiga={haiga} compact={true} />
        </DataListItem>
      ))}
    </DataList>
  );
}

export default AdminHaigaPage;
