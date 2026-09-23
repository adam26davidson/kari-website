import { useEffect, useId, useMemo, useState } from "react";
import { Card } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { PageTitle } from "../components/page-title/page-title";
import { FieldLabel } from "../components/field-label/field-label";
import { greetingFor } from "./greeting";
import { useAdminAccount } from "../auth/use-admin-account";
import { useAdminToken } from "../hooks/use-admin-token";
import { HomePageData } from "@kari/shared/models";
import { PhotoPicker } from "../components/photo-picker/photo-picker";
import { ImageService } from "@kari/shared/services/images";
import { HomePageService } from "@kari/shared/services/home-page";
import { LoadError } from "../components/load-error/load-error";
import { useAdminUi } from "../admin-ui-context";
import { useUnsavedChanges } from "../use-unsaved-changes";
import { useAssistantSubject } from "../assistant/use-assistant-subject";
import { SitePreview } from "../components/site-preview/site-preview";
import { PreviewOverrides } from "@kari/shared/utils/preview-channel";

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
  const dirty =
    !!imageFile ||
    JSON.stringify(homePageData) !== JSON.stringify(savedHomePageData);
  useUnsavedChanges(dirty);
  // No id and no title: this is the one home page, not an item out of a
  // list, and the helper's page context has a shape for that.
  useAssistantSubject({ what: "home page", dirty });

  // What the preview pane below the form is asked to render: the form as it
  // stands, including a photo she has picked but not uploaded (#239).
  // Memoised because SitePreview debounces on this object's identity — a
  // fresh one per render would restart the debounce forever and never send.
  const previewOverrides = useMemo<PreviewOverrides>(
    () => ({ homePage: { ...homePageData, photoFile: imageFile } }),
    [homePageData, imageFile],
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
      <div className="home-page-editor mx-auto flex w-full max-w-[720px] flex-col gap-8">
        <PageTitle>{greetingFor(new Date().getHours(), name)}</PageTitle>
        <Card className="flex flex-col gap-6 p-5 sm:p-8">
          <div className="flex flex-col gap-2">
            {/* No `htmlFor`: the picker is a composite, not one
                control. */}
            <FieldLabel>Your photo</FieldLabel>
            <PhotoPicker
              imageFile={imageFile}
              fileName={homePageData.photo}
              setImageFile={setImageFile}
            />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={blurbId}>Your welcome text</FieldLabel>
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
            {/* `admin-button` styles nothing: it is the e2e journeys' hook
                for Save (see the hook-class note in e2e/helpers.ts). The
                width utilities are the boards' full-width-on-a-phone
                Save. */}
            <Button
              className="admin-button w-full sm:w-auto"
              onClick={saveData}
            >
              Save
            </Button>
          </div>
        </Card>
        {/* Below the form, not beside it: the boards give this column one
            card at a time, and on a phone there is no "beside". */}
        <SitePreview
          path="/"
          description="This is how your home page will look with the changes above. It updates as you type, before you save."
          overrides={previewOverrides}
        />
      </div>
    )
  );
}
