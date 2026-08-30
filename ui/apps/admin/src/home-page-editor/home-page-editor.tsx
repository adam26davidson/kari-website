import { useEffect, useId, useState } from "react";
import { Card } from "../components/card/card";
import "./home-page-editor.css";
import { useAdminToken } from "../hooks/use-admin-token";
import { HomePageData } from "@kari/shared/models";
import { PhotoPicker } from "../components/photo-picker/photo-picker";
import { ImageService } from "@kari/shared/services/images";
import { HomePageService } from "@kari/shared/services/home-page";
import { AdminButton } from "../components/admin-button/admin-button";
import { LoadError } from "@kari/shared/components/load-error/load-error";
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
  const blurbId = useId();

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
              <h2 className="admin-section-heading">Home page</h2>
              <p className="admin-section-explanation">
                The photo and welcome text at the top of the site&apos;s home
                page.
              </p>
              <div className="admin-field">
                {/* Group label: the picker is a composite, not one
                    control, so there is nothing to point `for` at. */}
                <span className="admin-field-label">Photo</span>
                <PhotoPicker
                  imageFile={imageFile}
                  fileName={homePageData.photo}
                  setImageFile={setImageFile}
                />
              </div>
              <div className="admin-field">
                <label className="admin-field-label" htmlFor={blurbId}>
                  Welcome text
                </label>
                <textarea
                  id={blurbId}
                  value={homePageData.blurb}
                  onChange={(e) => {
                    setHomePageData({
                      ...homePageData,
                      blurb: e.target.value,
                    });
                  }}
                />
              </div>
              <AdminButton onClick={saveData}>Save</AdminButton>
            </div>
          </Card>
        </div>
      </div>
    )
  );
}
