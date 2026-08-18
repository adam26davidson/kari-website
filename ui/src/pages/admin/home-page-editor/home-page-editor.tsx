import { useEffect, useState } from "react";
import { Card } from "../components/card/card";
import "./home-page-editor.css";
import { useAdminToken } from "../../../hooks/use-admin-token";
import { HomePageData } from "../../../models";
import { PhotoPicker } from "../components/photo-picker/photo-picker";
import { ImageService } from "../../../services/images";
import { HomePageService } from "../../../services/home-page";
import { AdminButton } from "../components/admin-button/admin-button";
import { LoadError } from "../../../components/load-error/load-error";
import { useAdminUi } from "../admin-ui-context";
import { useUnsavedChanges } from "../use-unsaved-changes";

export function HomePageEditor() {
  const { isLoading, showLoading, hideLoading, notify } = useAdminUi();
  const [homePageData, setHomePageData] = useState<HomePageData>({
    photo: "",
    blurb: "",
  });
  // The last loaded or saved data — the baseline the form is compared
  // against to decide whether there are unsaved edits.
  const [savedHomePageData, setSavedHomePageData] = useState<HomePageData>({
    photo: "",
    blurb: "",
  });
  const getAccessTokenSilently = useAdminToken();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // The form is dirty when its fields differ from the loaded data or a
  // replacement photo is pending; navigating away then requires
  // confirmation.
  useUnsavedChanges(
    !!imageFile ||
      JSON.stringify(homePageData) !== JSON.stringify(savedHomePageData),
  );

  const fetchHomePageData = async () => {
    showLoading("Loading home page data...");
    setLoadFailed(false);
    try {
      const data = await HomePageService.getFromApi(getAccessTokenSilently);
      setHomePageData(data);
      setSavedHomePageData(data);
    } catch (error) {
      // Never show an empty editor after a failed load — saving it would
      // overwrite the real data.
      console.error(error);
      setLoadFailed(true);
    } finally {
      hideLoading();
    }
  };

  useEffect(() => {
    fetchHomePageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveData = async () => {
    showLoading("Updating home page data...");
    try {
      const newHomePageData = { ...homePageData };
      if (imageFile) {
        // Upload the replacement first — the JSON is only written after
        // the upload has succeeded, so a failure at any step leaves the
        // published home page intact.
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

      // The replaced photo is deliberately NOT deleted: it may still be
      // referenced by other content (e.g. as the site background), and if
      // not, the image-cleanup sweep collects it later.
      await HomePageService.update(newHomePageData, getAccessTokenSilently);
      setHomePageData(newHomePageData);
      setSavedHomePageData(newHomePageData);
      setImageFile(null);
      notify("Home page saved");
    } catch (error) {
      console.error(error);
      notify("Failed to save — your change was not saved", "error");
    } finally {
      hideLoading();
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
