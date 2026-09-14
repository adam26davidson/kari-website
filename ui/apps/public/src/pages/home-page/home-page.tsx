import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import "./home-page.css";
import { HomePageData } from "@kari/shared/models";
import { LoadError } from "@kari/shared/components/load-error/load-error";
import { HomePageService } from "@kari/shared/services/home-page";
import { useS3Load } from "@kari/shared/hooks/use-s3-load";
import { useObjectUrl } from "@kari/shared/hooks/use-object-url";
import {
  onS3ImageError,
  s3ImageUrl,
} from "@kari/shared/utils/image-management-helpers";
import { usePreviewOverrides } from "../../preview/preview-overrides-context";

const EMPTY_HOME_PAGE: HomePageData = {
  photo: "",
  blurb: "",
};

export function Home() {
  const isMobile = useIsMobile();
  const {
    data: loadedHomePageData,
    isLoading,
    loadFailed,
    load,
  } = useS3Load(HomePageService.getFromS3, EMPTY_HOME_PAGE);

  // When the admin is previewing an unsaved edit, its draft replaces the
  // deployed data outright (#239). `homePage` carries the whole page — blurb
  // and photo — so there is nothing left to wait for and nothing a failed
  // S3 read could take away: the pane shows the page as it would be if she
  // saved, even if S3 is having a bad minute.
  const { homePage: draft } = usePreviewOverrides();
  // A photo she has picked but not uploaded, rendered straight from the File
  // the editor structured-cloned across.
  const draftPhotoUrl = useObjectUrl(draft?.photoFile ?? null);

  const homePageData = draft ?? loadedHomePageData;
  const storedPhotoUrl = homePageData.photo
    ? s3ImageUrl(homePageData.photo)
    : "";
  const photoSrc = draftPhotoUrl ?? storedPhotoUrl;

  return (
    <div className={isMobile ? "home-page mobile" : "home-page"}>
      {!draft && isLoading && <div className="loading">Loading...</div>}
      {!draft && !isLoading && loadFailed && (
        <LoadError message="Failed to load home page." onRetry={load} />
      )}
      {(draft || (!isLoading && !loadFailed)) && (
        <div className="home-page-card">
          <div className="fade-in fade-in-delay-1 home-page-photo-container">
            {photoSrc && (
              <img
                className="home-page-photo"
                src={photoSrc}
                // A blob: URL has no S3 key behind it, so the legacy-layout
                // fallback would only rewrite it into a 404.
                onError={draftPhotoUrl ? undefined : onS3ImageError}
                alt="Kari Davidson"
              />
            )}
          </div>
          <div className="fade-in fade-in-delay-2 home-page-divider"></div>
          <div className="fade-in fade-in-delay-3 home-page-blurb">
            {homePageData.blurb}
          </div>
        </div>
      )}
    </div>
  );
}
