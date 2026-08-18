import { useEffect, useState } from "react";
import "./admin-background-page.css";
import { Card } from "../../../components/card/card";
import { useAdminToken } from "../../../hooks/use-admin-token";
import { SiteSettings } from "../../../models";
import { PhotoPicker } from "../../../components/photo-picker/photo-picker";
import { ImageService } from "../../../services/images";
import { SiteSettingsService } from "../../../services/site-settings";
import { AdminButton } from "../../../components/admin-button/admin-button";
import { LoadError } from "../../../components/load-error/load-error";
import { useAdminUi } from "../admin-ui-context";
import { useUnsavedChanges } from "../use-unsaved-changes";
import { apiImageUrl } from "../../../utils/image-management-helpers";
import {
  BackgroundImageError,
  prepareBackgroundImage,
} from "../../../utils/background-image";
import defaultBackground from "../../../assets/petals_on_ground.webp";

const DEFAULT_SETTINGS: SiteSettings = { backgroundPhoto: "" };

export function AdminBackgroundPage() {
  const { isLoading, showLoading, hideLoading, notify } = useAdminUi();
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  // The last loaded or saved settings — the baseline the form is compared
  // against to decide whether there are unsaved edits.
  const [savedSettings, setSavedSettings] =
    useState<SiteSettings>(DEFAULT_SETTINGS);
  const [existingImages, setExistingImages] = useState<Array<string>>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const getAccessTokenSilently = useAdminToken();

  useUnsavedChanges(
    !!imageFile || settings.backgroundPhoto !== savedSettings.backgroundPhoto,
  );

  const fetchData = async () => {
    showLoading("Loading site background...");
    setLoadFailed(false);
    try {
      const [loadedSettings, images] = await Promise.all([
        SiteSettingsService.getFromApi(getAccessTokenSilently),
        ImageService.list(getAccessTokenSilently),
      ]);
      setSettings(loadedSettings);
      setSavedSettings(loadedSettings);
      setExistingImages(images);
    } catch (error) {
      // Never show an empty editor after a failed load — saving it would
      // overwrite the real settings.
      console.error(error);
      setLoadFailed(true);
    } finally {
      hideLoading();
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveData = async () => {
    showLoading("Updating site background...");
    try {
      const newSettings = { ...settings };
      if (imageFile) {
        // Validate/downscale, then upload first — the settings are only
        // written after the upload succeeds, so a failure at any step
        // leaves the published background intact.
        const prepared = await prepareBackgroundImage(imageFile);
        const newFileName = await ImageService.upload(
          prepared,
          true,
          getAccessTokenSilently,
        );
        if (!newFileName) {
          throw new Error("Failed to upload image");
        }
        newSettings.backgroundPhoto = newFileName;
      } else if (newSettings.backgroundPhoto) {
        // An already-uploaded image may have been stored unpublished (e.g.
        // a draft post's image); the public site reads the background
        // straight from S3, so it must be public before it is referenced.
        await ImageService.setPublished(
          newSettings.backgroundPhoto,
          true,
          getAccessTokenSilently,
        );
      }

      // The replaced photo is deliberately NOT deleted: it may still be
      // referenced by other content, and if not, the image-cleanup sweep
      // collects it later.
      await SiteSettingsService.update(newSettings, getAccessTokenSilently);
      setSettings(newSettings);
      setSavedSettings(newSettings);
      setImageFile(null);
      // Surface a freshly uploaded background in the picker grid without
      // refetching the whole listing.
      if (
        newSettings.backgroundPhoto &&
        !existingImages.includes(newSettings.backgroundPhoto)
      ) {
        setExistingImages([newSettings.backgroundPhoto, ...existingImages]);
      }
      notify("Site background saved");
    } catch (error) {
      console.error(error);
      notify(
        error instanceof BackgroundImageError
          ? error.message
          : "Failed to save — your change was not saved",
        "error",
      );
    } finally {
      hideLoading();
    }
  };

  const pickExisting = (name: string) => {
    setImageFile(null);
    setSettings({ ...settings, backgroundPhoto: name });
  };

  const useDefault = () => {
    setImageFile(null);
    setSettings({ ...settings, backgroundPhoto: "" });
  };

  const showingDefault = !imageFile && settings.backgroundPhoto === "";

  if (loadFailed) {
    return (
      <LoadError
        message="Failed to load the site background settings."
        onRetry={fetchData}
      />
    );
  }

  return (
    !isLoading && (
      <div className="admin-background-page">
        <div className="admin-background-editor">
          <Card>
            <div className="admin-background-card-content">
              <h2>Site background</h2>
              <p className="admin-background-explanation">
                The photo shown behind every page of the site. Upload a new
                image or pick an already-uploaded one; large photos are
                automatically resized so the site stays fast.
              </p>
              {showingDefault ? (
                <div className="admin-background-default-preview">
                  <img
                    src={defaultBackground}
                    alt="Default background"
                    className="admin-background-default-image"
                  />
                  <span>Default background</span>
                </div>
              ) : (
                <AdminButton onClick={useDefault}>
                  Use default background
                </AdminButton>
              )}
              <PhotoPicker
                imageFile={imageFile}
                fileName={settings.backgroundPhoto}
                setImageFile={setImageFile}
              />
              {existingImages.length > 0 && (
                <details className="admin-background-existing">
                  <summary>
                    Pick an already-uploaded image ({existingImages.length})
                  </summary>
                  <div className="admin-background-existing-grid">
                    {existingImages.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={
                          !imageFile && settings.backgroundPhoto === name
                            ? "admin-background-thumb selected"
                            : "admin-background-thumb"
                        }
                        onClick={() => pickExisting(name)}
                        aria-label={`Use ${name} as the background`}
                      >
                        <img src={apiImageUrl(name)} alt={name} />
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <AdminButton onClick={saveData}>Save</AdminButton>
            </div>
          </Card>
        </div>
      </div>
    )
  );
}
