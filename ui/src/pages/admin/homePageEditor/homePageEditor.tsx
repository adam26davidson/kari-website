import { useEffect, useState } from "react";
import { Card } from "../../../components/card/card";
import "./homePageEditor.css";
import { useAdminToken } from "../../../hooks/useAdminToken";
import { HomePageData } from "../../../Models";
import { PhotoPicker } from "../../../components/photo-picker/photo-picker";
import { ImageService } from "../../../services/images";
import { Notify } from "../admin";
import { AdminButton } from "../../../components/admin-button/admin-button";
import { LoadError } from "../../../components/load-error/load-error";

const API_URL = import.meta.env.VITE_API_URL;
const HOME_PAGE_DATA_ENDPOINT = `${API_URL}/home-page`;

export interface HomePageEditorProps {
  setLoading: (loading: { isLoading: boolean; message: string }) => void;
  isLoading: boolean;
  notify: Notify;
}

export function HomePageEditor({
  setLoading,
  isLoading,
  notify,
}: HomePageEditorProps) {
  const [homePageData, setHomePageData] = useState<HomePageData>({
    photo: "",
    blurb: "",
  });
  const getAccessTokenSilently = useAdminToken();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchHomePageData = async () => {
    setLoading({
      isLoading: true,
      message: "Loading home page data...",
    });
    setLoadFailed(false);
    try {
      const token = await getAccessTokenSilently();
      const response = await fetch(HOME_PAGE_DATA_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch home page data (HTTP ${response.status})`,
        );
      }
      const data: HomePageData = await response.json();
      setHomePageData(data);
    } catch (error) {
      // Never show an empty editor after a failed load — saving it would
      // overwrite the real data.
      console.error(error);
      setLoadFailed(true);
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
  };

  useEffect(() => {
    fetchHomePageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveData = async () => {
    setLoading({
      isLoading: true,
      message: "Updating home page data...",
    });
    try {
      const newHomePageData = { ...homePageData };
      if (imageFile) {
        // delete the old image if it exists; a missing image should not
        // block saving
        if (homePageData.photo) {
          await ImageService.delete(
            homePageData.photo,
            getAccessTokenSilently,
          ).catch(console.error);
        }

        // upload the new image
        const newFileName = await ImageService.upload(
          imageFile,
          true,
          getAccessTokenSilently,
        );
        if (!newFileName) {
          throw new Error("Failed to upload image");
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
      if (!response.ok) {
        throw new Error(
          `Failed to save home page data (HTTP ${response.status})`,
        );
      }
      notify("Home page saved");
    } catch (error) {
      console.error(error);
      notify("Failed to save — your change was not saved", "error");
    } finally {
      setLoading({ isLoading: false, message: "" });
    }
  };

  if (loadFailed) {
    return (
      <LoadError
        message="Failed to load home page data."
        onRetry={fetchHomePageData}
      />
    );
  }

  return (
    !isLoading && (
      <div className="home-page-editor-container">
        <div className="home-page-editor">
          <Card>
            <div className="home-page-editor-card-content">
              <PhotoPicker
                imageFile={imageFile}
                fileName={homePageData.photo}
                setImageFile={setImageFile}
              />
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
              <AdminButton onClick={saveData}>Save</AdminButton>
            </div>
          </Card>
        </div>
      </div>
    )
  );
}
