import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { cn } from "../components/ui/cn";
import { PageTitle } from "../components/page-title/page-title";
import { useAdminToken } from "../hooks/use-admin-token";
import { SiteSettings } from "@kari/shared/models";
import { PhotoPicker } from "../components/photo-picker/photo-picker";
import { ImageService } from "@kari/shared/services/images";
import { SiteSettingsService } from "@kari/shared/services/site-settings";
import { LoadError } from "@kari/shared/components/load-error/load-error";
import { useAdminUi } from "../admin-ui-context";
import { useUnsavedChanges } from "../use-unsaved-changes";
import { useAssistantSubject } from "../assistant/use-assistant-subject";
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

  const dirty = !!imageFile || !sameSettings(settings, savedSettings);
  useUnsavedChanges(dirty);
  // Her word for this section is what the menu says — "Appearance" — and
  // the helper's own page map uses the same one.
  useAssistantSubject({ what: "appearance", dirty });

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

  /** What both sub-sections report an edit through. */
  const updateSettings = (change: Partial<SiteSettings>) =>
    setSettings({ ...settings, ...change });

  return (
    !isLoading && (
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-7">
        <PageTitle>Appearance</PageTitle>
        {/* Two columns of cards on a wide screen, one calm column below it
            — what the boards draw (Appearance.png / AppearanceMobile.png).
            Fonts spans both because its four samples need the width more
            than anything else on the page does. */}
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <Card className="flex min-w-0 flex-col items-start gap-4 p-5 sm:p-6">
            <h3 className="text-foreground font-serif text-xl italic">
              Site background
            </h3>
            <p className="text-muted-foreground max-w-[60ch] font-sans text-sm leading-relaxed">
              The photo shown behind every page of the site. Upload a new
              image or pick an already-uploaded one; large photos are
              automatically resized so the site stays fast.
            </p>
            {showingDefault ? (
              <div className="flex flex-col items-start gap-2">
                <img
                  src={defaultBackground}
                  alt="Default background"
                  className="border-border max-h-40 max-w-full rounded-lg border object-contain sm:max-w-56"
                />
                <span className="text-muted-foreground font-sans text-sm">
                  Default background
                </span>
              </div>
            ) : (
              // Only offered when there is something to put back: a reset
              // that changes nothing is a button that does nothing.
              <Button variant="secondary" onClick={useDefault}>
                Use the default background
              </Button>
            )}
            <PhotoPicker
              imageFile={imageFile}
              fileName={settings.backgroundPhoto}
              setImageFile={setImageFile}
            />
            {existingImages.length > 0 && (
              // Folded away rather than the boards' open grid: they draw
              // five sample tiles, the real listing can be dozens, and an
              // always-open grid would swamp the card (design brief §1).
              // Same chevron panel the image-cleanup page uses.
              <details className="border-border group w-full min-w-0 rounded-lg border">
                <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-sans text-sm font-medium [&::-webkit-details-marker]:hidden">
                  Pick an already-uploaded image ({existingImages.length})
                  {/* Decorative: <summary> already announces itself as
                      expandable and says which way it is. */}
                  <ChevronRight
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90"
                  />
                </summary>
                <div className="flex flex-wrap gap-2 px-4 pb-4">
                  {existingImages.map((name) => {
                    const picked =
                      !imageFile && settings.backgroundPhoto === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        // `aria-pressed` rather than a class alone: the
                        // green ring says "this is the one" to anyone
                        // looking, and this says it to anyone listening.
                        aria-pressed={picked}
                        className={cn(
                          "cursor-pointer rounded-md leading-[0] ring-offset-2",
                          "ring-offset-card transition-shadow",
                          picked
                            ? "ring-primary ring-2"
                            : "hover:ring-primary/60 hover:ring-2",
                        )}
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
                          className="bg-muted size-24 rounded-md object-cover"
                        />
                      </button>
                    );
                  })}
                </div>
              </details>
            )}
          </Card>
          <Card className="min-w-0 p-5 sm:p-6">
            <HeaderColorsSection settings={settings} onChange={updateSettings} />
          </Card>
          <Card className="min-w-0 p-5 sm:p-6 lg:col-span-2">
            <FontPairingSection settings={settings} onChange={updateSettings} />
          </Card>
        </div>
        {/* The page's one Save, under everything it saves. Column-REVERSE
            on a phone: the boards put the full-width Save above the line
            explaining it, so the button stays where her thumb is and the
            caption reads as a footnote to it. */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-center font-sans text-sm sm:text-left">
            Changes appear on your site once you save.
          </p>
          {/* `admin-button` is the e2e journeys' hook for Save, the same
              convention AdminButton's LEGACY_CLASS documents. The vendored
              Button directly (rather than AdminButton) because this one
              needs the boards' full-width-on-a-phone Save, which
              AdminButton's four-weights API deliberately does not take. */}
          <Button className="admin-button w-full sm:w-auto" onClick={saveData}>
            Save
          </Button>
        </div>
      </div>
    )
  );
}
