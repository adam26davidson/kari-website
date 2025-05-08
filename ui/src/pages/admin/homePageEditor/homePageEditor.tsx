import { useEffect, useState } from "react";
import { Card } from "../../../components/card/card";
import "./homePageEditor.css";
import { useAuth0 } from "@auth0/auth0-react";
import { HomePageData } from "../../../Models";
import { PhotoPicker } from "../../../components/photo-picker/photo-picker";
import { ImageService } from "../../../services/images";
import { Confirmation } from "../admin";

const API_URL = import.meta.env.VITE_API_URL;
const HOME_PAGE_DATA_ENDPOINT = `${API_URL}/home-page`;

export interface HomePageEditorProps {
  setConfirmation: (confirmation: Confirmation) => void;
  setLoading: (loading: { isLoading: boolean; message: string }) => void;
  isLoading: boolean;
}

export function HomePageEditor({
  setConfirmation,
  setLoading,
  isLoading,
}: HomePageEditorProps) {
  const [homePageData, setHomePageData] = useState<HomePageData>({
    photo: "",
    blurb: "",
  });
  const { getAccessTokenSilently } = useAuth0();
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    const fetchHomePageData = async () => {
      setLoading({
        isLoading: true,
        message: "Loading home page data...",
      });
      const token = await getAccessTokenSilently();
      const response = await fetch(HOME_PAGE_DATA_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data: HomePageData = await response.json();
      console.log(data);
      setHomePageData(data);
      setLoading({ isLoading: false, message: "" });
    };
    fetchHomePageData();
  }, [getAccessTokenSilently, setLoading]);

  const saveData = async () => {
    setLoading({
      isLoading: true,
      message: "Updating home page data...",
    });
    const newHomePageData = { ...homePageData };
    if (imageFile) {
      // delete the old image if it exists
      if (homePageData.photo) {
        await ImageService.delete(homePageData.photo, getAccessTokenSilently);
      }

      // upload the new image
      const newFileName = await ImageService.upload(
        imageFile,
        true,
        getAccessTokenSilently,
      );
      if (!newFileName) {
        console.error("Failed to upload image");
        return;
      }
      newHomePageData.photo = newFileName;
      setHomePageData(newHomePageData);
    }

    const token = await getAccessTokenSilently();
    const response = await fetch(HOME_PAGE_DATA_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newHomePageData),
    });
    const responseBody = await response.json();
    console.log(responseBody);
    setLoading({ isLoading: false, message: "" });
    setConfirmation({
      show: true,
      message: "Home page data has been saved",
      options: [{ label: "Ok", callback: () => {} }],
    });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file: File = event.target.files[0];
      setImageFile(file);
    } else {
      setImageFile(null);
    }
  };

  return (
    !isLoading && (
      <div className="home-page-editor-container">
        <div className="home-page-editor">
          <Card>
            <div className="home-page-editor-card-content">
              <PhotoPicker
                imageFile={imageFile}
                fileName={homePageData.photo}
                handleFileSelect={handleFileSelect}
              />
              <div className="home-page-editor-blurb">
                <textarea
                  value={homePageData.blurb}
                  placeholder="Blurb"
                  onChange={(e) => {
                    setHomePageData({
                      ...homePageData,
                      blurb: e.target.value,
                    });
                  }}
                />
              </div>
              <div>
                <button
                  className="admin-button"
                  style={{ marginLeft: "10px" }}
                  onClick={saveData}
                >
                  Save
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    )
  );
}
