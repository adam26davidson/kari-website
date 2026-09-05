import { useEffect, useState } from "react";
import "./admin-background-page.css";
import { Card } from "../components/card/card";
import { useAdminToken } from "../hooks/use-admin-token";
import { SiteSettings } from "@kari/shared/models";
import { PhotoPicker } from "../components/photo-picker/photo-picker";
import { ImageService } from "@kari/shared/services/images";
import { SiteSettingsService } from "@kari/shared/services/site-settings";
import { AdminButton } from "../components/admin-button/admin-button";
import { LoadError } from "@kari/shared/components/load-error/load-error";
import { useAdminUi } from "../admin-ui-context";
import { useUnsavedChanges } from "../use-unsaved-changes";
import { apiImageUrl } from "@kari/shared/utils/image-management-helpers";
import {
  BackgroundImageError,
  validateBackgroundImage,
} from "@kari/shared/utils/background-image";
import defaultBackground from "@kari/shared/assets/petals_on_ground.webp";
import { HeaderColorsSection } from "./header-colors-section";
import { FontPairingSection } from "./font-pairing-section";

const DEFAULT_SETTINGS: SiteSettings = { backgroundPhoto: "" };

/**
 * Every field the page edits, grouped by the thing it changes, with what a
 * save that touched only that group should say it saved.
 *
 * Grouped rather than listed because the confirmation has to name what was
 * actually kept: "Site background saved" after a font change would read as
 * the wrong thing having been saved. The groups also stop that message
 * being derived positionally — it used to be "every field but the first",
 * which silently mis-reports the moment a field is appended.
 */
const SETTINGS_GROUPS = [
  { message: "Site background saved", fields: ["backgroundPhoto"] },
  {
    message: "Header colours saved",
    fields: ["headerBackgroundColor", "headerTitleColor", "headerNavColor"],
  },
  { message: "Site fonts saved", fields: ["fontPairing"] },
] as const satisfies ReadonlyArray<{
  message: string;
  fields: ReadonlyArray<keyof SiteSettings>;
}>;

/** What a save that touched more than one group (or none) says. */
const MIXED_SAVE_MESSAGE = "Appearance settings saved";

/** Every field the page edits, in the object it saves. */
const SETTINGS_FIELDS = SETTINGS_GROUPS.flatMap((group) => group.fields);

/**
 * Whether two settings objects say the same thing. Everything but the photo
 * is optional, and the API answers with "" where freshly built local state
 * has `undefined`, so the two have to compare equal — otherwise every load
 * of a settings object written before the colours or the fonts existed
 * would look like an unsaved edit and the guard would fire on the way out.
 */
const sameSettings = (a: SiteSettings, b: SiteSettings) =>
  SETTINGS_FIELDS.every((field) => (a[field] ?? "") === (b[field] ?? ""));

/** What to tell her a save kept, given what it actually changed. */
const saveMessage = (next: SiteSettings, previous: SiteSettings) => {
  const changed = SETTINGS_GROUPS.filter((group) =>
    group.fields.some(
      (field) => (next[field] ?? "") !== (previous[field] ?? ""),
    ),
  );
  return changed.length === 1 ? changed[0].message : MIXED_SAVE_MESSAGE;
};

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

  useUnsavedChanges(!!imageFile || !sameSettings(settings, savedSettings));

  const fetchData = async () => {
    showLoading("Loading the site's appearance...");
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
    showLoading("Saving the site's appearance...");
    try {
      const newSettings = { ...settings };
      if (imageFile) {
        // Validate, then upload the file UNTOUCHED — the API keeps the
        // original and derives the page-sized background from it (#453).
        // Upload first: the settings are only written after it succeeds, so
        // a failure at any step leaves the published background intact.
        await validateBackgroundImage(imageFile);
        const newFileName = await ImageService.upload(
          imageFile,
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
      notify(saveMessage(newSettings, savedSettings));
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
        message="Failed to load the site's appearance settings."
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
              <h2 className="admin-section-heading">Site background</h2>
              <p className="admin-section-explanation">
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
                <AdminButton variant="secondary" onClick={useDefault}>
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
                        <img
                          src={apiImageUrl(name, "thumb")}
                          alt={name}
                          loading="lazy"
                          decoding="async"
                          width={96}
                          height={96}
                        />
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <HeaderColorsSection
                settings={settings}
                onChange={(change) => setSettings({ ...settings, ...change })}
              />
              <FontPairingSection
                settings={settings}
                onChange={(change) => setSettings({ ...settings, ...change })}
              />
              <AdminButton onClick={saveData}>Save</AdminButton>
            </div>
          </Card>
        </div>
      </div>
    )
  );
}
