import { useEffect, useId, useState } from "react";
import { Card } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { PageTitle } from "../components/page-title/page-title";
import { greetingFor } from "./greeting";
import { useAdminAccount } from "../auth/use-admin-account";
import { useAdminToken } from "../hooks/use-admin-token";
import { HomePageData } from "@kari/shared/models";
import { PhotoPicker } from "../components/photo-picker/photo-picker";
import { ImageService } from "@kari/shared/services/images";
import { HomePageService } from "@kari/shared/services/home-page";
import { LoadError } from "@kari/shared/components/load-error/load-error";
import { useAdminUi } from "../admin-ui-context";
import { useUnsavedChanges } from "../use-unsaved-changes";

export function HomePageEditor() {
  const { isLoading, showLoading, hideLoading, notify } = useAdminUi();
  const { name } = useAdminAccount();
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
      // `home-page-editor` is not styling — it is how the e2e home journey
      // finds this page's textarea (e2e/admin-journeys.spec.ts).
      <div className="home-page-editor mx-auto flex w-full max-w-[720px] flex-col gap-5">
        <PageTitle>{greetingFor(new Date().getHours(), name)}</PageTitle>
        <Card className="flex flex-col gap-6 p-5 sm:p-8">
          <div className="flex flex-col gap-2">
            {/* Group label: the picker is a composite, not one control, so
                there is nothing to point `for` at. */}
            <span className="text-muted-foreground font-sans text-sm">
              Your photo
            </span>
            <PhotoPicker
              imageFile={imageFile}
              fileName={homePageData.photo}
              setImageFile={setImageFile}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              className="text-muted-foreground font-sans text-sm"
              htmlFor={blurbId}
            >
              Your welcome text
            </label>
            <Textarea
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
          {/* Column-REVERSE on a phone: the boards put the full-width Save
              above the line explaining it, so the button stays where her
              thumb is and the caption reads as a footnote to it. */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-center font-sans text-sm sm:text-left">
              Changes appear on your site once you save.
            </p>
            {/* `admin-button` is the e2e journeys' hook for Save, the same
                convention AdminButton's LEGACY_CLASS documents. The vendored
                Button directly (rather than AdminButton) because this one
                needs the boards' full-width-on-a-phone Save, which
                AdminButton's four-weights API deliberately does not take. */}
            <Button
              className="admin-button w-full sm:w-auto"
              onClick={saveData}
            >
              Save
            </Button>
          </div>
        </Card>
      </div>
    )
  );
}
