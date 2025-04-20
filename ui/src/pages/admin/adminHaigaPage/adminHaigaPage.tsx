/* eslint-disable react-hooks/exhaustive-deps */
import { useState } from "react";
import "./adminHaigaPage.css";
import { Confirmation, Loading } from "../admin";
import { useAuth0 } from "@auth0/auth0-react";
import DataList from "../../../components/dataList/dataList";
import { v4 as uuidv4 } from "uuid";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowPointer } from "@fortawesome/free-solid-svg-icons";
import { Haiga } from "../../../Models";
import { HaigaContent } from "../../../components/haigaContent/haigaContent";

const HAIGA_ENDPOINT = import.meta.env.VITE_API_URL + "/haiga";
const IMAGES_ENDPOINT = import.meta.env.VITE_API_URL + "/images";

interface HaigaEditorProps {
  isLoading: boolean;
  setLoading: (loading: Loading) => void;
  isConfirming: boolean;
  setConfirmation: (confirmation: Confirmation) => void;
}

function AdminHaigaPage(props: HaigaEditorProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [haigaList, setHaigaList] = useState<Array<Haiga>>([]);
  const [newHaiga, setNewHaiga] = useState<Haiga>({
    title: "",
    lines: [],
    image: "",
    publisher: "",
    id: "",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);

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

  const uploadImage = async (file: File | null) => {
    props.setLoading({ isLoading: true, message: "Uploading image..." });
    if (!file) {
      console.error("No file provided for upload.");
      return;
    }

    // Get the access token from Auth0
    const token = await getAccessTokenSilently();

    // give the file a unique name - you could use the original name, but this is safer
    const fileName = `${uuidv4()}.${file.name.split(".").pop()}`;

    // rename thge file to the unique name
    file = new File([file], fileName, { type: file.type });

    // Create a FormData object and append the file
    const formData = new FormData();
    formData.append("file", file); // Ensure that your server is expecting the file under the key "file"

    // Set up the request to your file upload endpoint
    try {
      const response = await fetch(IMAGES_ENDPOINT, {
        method: "POST",
        headers: {
          // Normally, Content-Type is automatically set to multipart/form-data by the browser when you use FormData
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log("Upload successful", await response.text());
      props.setLoading({ isLoading: false, message: "" });
      return fileName;
    } catch (error) {
      console.error("Failed to upload image", error);
      props.setLoading({ isLoading: false, message: "" });
      throw error;
    }
  };

  const deleteImage = async (fileName: string) => {
    props.setLoading({ isLoading: true, message: "Deleting image..." });
    const token = await getAccessTokenSilently();
    const response = await fetch(`${IMAGES_ENDPOINT}/${fileName}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      console.error(`Failed to delete image: ${fileName}`);
    }
    props.setLoading({ isLoading: false, message: "" });
  };

  const saveNewHaiga = async () => {
    const fileName = await uploadImage(imageFile);
    if (!fileName) {
      console.error("Failed to upload image - aborting save");
      return;
    }
    const newDataList = [
      ...haigaList,
      { ...newHaiga, id: uuidv4(), image: fileName },
    ];
    await saveHaiga(newDataList);
    setHaigaList(newDataList);
  };

  const deleteHaiga = (idx: number) => async () => {
    const newDataList = haigaList.slice();
    newDataList.splice(idx, 1);
    await deleteImage(haigaList[idx].image);
    await saveHaiga(newDataList);
    setHaigaList(newDataList);
  };

  const newHaigaIsValid = () => {
    return (
      newHaiga.title.trim().length > 0 &&
      newHaiga.lines.length > 0 &&
      newHaiga.lines[0].length > 0 &&
      imageFile !== null
    );
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file: File = event.target.files[0];
      setImageFile(file);
    } else {
      setImageFile(null);
    }
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
          id="image-upload"
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          hidden
        />
        {imageFile && (
          <div className="admin-image-upload-selection">
            <span>{imageFile.name}</span>
            <img
              src={URL.createObjectURL(imageFile)}
              alt="Selected"
              className="admin-image-preview"
            />
          </div>
        )}
        <label htmlFor="image-upload" className="admin-image-upload">
          <FontAwesomeIcon icon={faArrowPointer} />
          <div className="spacer"></div>
          {imageFile ? "Select Different Image" : "Select Image"}
        </label>
      </>
    );
  };

  return (
    <DataList<Haiga>
      dataList={haigaList}
      isLoading={props.isLoading}
      isAdmin={true}
      itemContent={(idx: number) => (
        <HaigaContent haigaList={haigaList} idx={idx} />
      )}
      adminProps={{
        newItem: newHaiga,
        isConfirming: props.isConfirming,
        setDataList: setHaigaList,
        setLoading: props.setLoading,
        setConfirmation: props.setConfirmation,
        loadData: loadHaiga,
        saveData: saveHaiga,
        saveNewItem: saveNewHaiga,
        deleteItem: deleteHaiga,
        newItemIsValid: newHaigaIsValid,
        itemEditor: newHaigaEditor,
      }}
    />
  );
}

export default AdminHaigaPage;
