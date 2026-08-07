import { useEffect, useState } from "react";
import { Card } from "../../../components/card/card";
import "./homePageEditor.css";
import { useAdminToken } from "../../../hooks/useAdminToken";
import { HomePageData } from "../../../Models";
import { PhotoPicker } from "../../../components/photo-picker/photo-picker";
import { ImageService } from "../../../services/images";
import { HomePageService } from "../../../services/home-page";
import { Notify } from "../admin";
import { AdminButton } from "../../../components/admin-button/admin-button";
import { LoadError } from "../../../components/load-error/load-error";

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
      const data = await HomePageService.getFromApi(getAccessTokenSilently);
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
      const previousPhoto = homePageData.photo;
      if (imageFile) {
        // Upload the replacement first — the old photo is only deleted
        // after the JSON save has succeeded, so a failure at any step
        // leaves the published home page intact.
        const newFileName = await ImageService.upload(
          imageFile,
          true,
          getAccessTokenSilently,
        );
        if (!newFileName) {
          throw new Error("Failed to upload image");
        }
        newHomePageData.photo = newFileName;
      }

      await HomePageService.update(newHomePageData, getAccessTokenSilently);
      setHomePageData(newHomePageData);
      setImageFile(null);
      // The save succeeded, so nothing references the old photo anymore;
      // a failed delete just leaves an orphan for later cleanup.
      if (previousPhoto && previousPhoto !== newHomePageData.photo) {
        await ImageService.delete(previousPhoto, getAccessTokenSilently).catch(
          console.error,
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
