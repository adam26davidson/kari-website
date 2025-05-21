/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import "./adminHaigaPage.css";
import { Confirmation, Loading } from "../admin";
import { useAuth0 } from "@auth0/auth0-react";
import DataList from "../../../components/dataList/dataList";
import { v4 as uuidv4 } from "uuid";
import { Haiga } from "../../../Models";
import { HaigaService } from "../../../services/haiga";
import { ImageService } from "../../../services/images";
import { HaigaEditor } from "./components/haiga-editor/haiga-editor";
import { moveItemByOne } from "../../../utils/data-list-helpers";
import DataListItem from "../../../components/dataListItem/dataListItem";
import { HaigaContent } from "../../../components/haigaContent/haigaContent";

interface HaigaEditorProps {
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
}

function AdminHaigaPage({ setLoading, setConfirmation }: HaigaEditorProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [haigaList, setHaigaList] = useState<Array<Haiga>>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [openHaiga, setOpenHaiga] = useState<Haiga | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading({ isLoading: true, message: "Loading haiga..." });
      const data = await HaigaService.getListFromApi(getAccessTokenSilently);
      setHaigaList(data);
      setLoading({ isLoading: false, message: "" });
    };
    load();
  }, []);

  const saveHaigaList = async (newHaigaList: Array<Haiga>) => {
    setLoading({ isLoading: true, message: "Updating haiga..." });
    await HaigaService.updateList(newHaigaList, getAccessTokenSilently);
    setHaigaList(newHaigaList);
    setLoading({ isLoading: false, message: "" });
  };

  const deleteHaiga = (idx: number) => async () => {
    const newDataList = haigaList.slice();
    newDataList.splice(idx, 1);
    if (haigaList[idx].image) {
      await deleteImage(haigaList[idx].image);
    }
    await saveHaigaList(newDataList);
    setConfirmation({
      show: true,
      message: "Haiga deleted successfully",
      options: [
        {
          label: "OK",
          callback: () =>
            setConfirmation({ show: false, message: "", options: [] }),
        },
      ],
    });
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
    setImageFile(null);
    setOpenHaiga(newHaiga);
    const newHaigaList = [...haigaList, { ...newHaiga }];
    await saveHaigaList(newHaigaList);
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
    await saveHaigaList(newHaigaList);
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
    const fileName = await ImageService.upload(
      file,
      true,
      getAccessTokenSilently,
    );
    setLoading({ isLoading: false, message: "" });
    return fileName;
  };

  const deleteImage = async (fileName: string) => {
    setLoading({ isLoading: true, message: "Deleting image..." });
    await ImageService.delete(fileName, getAccessTokenSilently);
    setLoading({ isLoading: false, message: "" });
  };

  const saveOpenHaiga = async () => {
    if (!openHaiga) return;
    let fileName = openHaiga.image;
    if (imageFile) {
      // delete the old image if it exists
      if (openHaiga.image) {
        await deleteImage(openHaiga.image);
      }

      // upload the new image
      const newFileName = await uploadImage(imageFile);
      if (!newFileName) {
        console.error("Failed to upload image");
        return;
      }
      openHaiga.image = newFileName;
      fileName = newFileName;
    }
    const editedHaiga: Haiga = { ...openHaiga, image: fileName };
    const newDataList = haigaList.slice();
    const idx = newDataList.findIndex((haiga) => haiga.id === openHaiga.id);
    if (idx === -1) {
      console.error("Haiga not found");
      return;
    }
    newDataList[idx] = editedHaiga;
    await saveHaigaList(newDataList);
  };

  const openHaigaIsValid = () => {
    if (!openHaiga) return false;

    return openHaiga.lines.length > 0 && openHaiga.lines[0].length > 0;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file: File = event.target.files[0];
      setImageFile(file);
    } else {
      setImageFile(null);
    }
  };

  return openHaiga ? (
    <HaigaEditor
      haiga={openHaiga}
      setHaiga={setOpenHaiga}
      validate={openHaigaIsValid}
      handleFileSelect={handleFileSelect}
      imageFile={imageFile}
      onSave={saveOpenHaiga}
      onClose={() => setOpenHaiga(null)}
    />
  ) : (
    <DataList isAdmin={true} onNewItem={onNewItem}>
      {haigaList.map((haiga, idx) => (
        <DataListItem
          isAdmin={true}
          isLast={idx === haigaList.length - 1}
          isFirst={idx === 0}
          onEdit={onEdit(idx)}
          onDelete={onDelete(idx)}
          onMoveUp={onMove(idx, "up")}
          onMoveDown={onMove(idx, "down")}
        >
          <HaigaContent haiga={haiga} />
        </DataListItem>
      ))}
    </DataList>
  );
}

export default AdminHaigaPage;
