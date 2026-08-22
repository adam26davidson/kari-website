import { useIsMobile } from "../../hooks/use-is-mobile";
import "./home-page.css";
import { HomePageData } from "../../models";
import { LoadError } from "../../components/load-error/load-error";
import { HomePageService } from "../../services/home-page";
import { useS3Load } from "../../hooks/use-s3-load";
import {
  onS3ImageError,
  s3ImageUrl,
} from "../../utils/image-management-helpers";

const EMPTY_HOME_PAGE: HomePageData = {
  photo: "",
  blurb: "",
};

export function Home() {
  const isMobile = useIsMobile();
  const {
    data: homePageData,
    isLoading,
    loadFailed,
    load,
  } = useS3Load(HomePageService.getFromS3, EMPTY_HOME_PAGE);

  return (
    <div className={isMobile ? "home-page mobile" : "home-page"}>
      {isLoading && <div className="loading">Loading...</div>}
      {!isLoading && loadFailed && (
        <LoadError message="Failed to load home page." onRetry={load} />
      )}
      {!isLoading && !loadFailed && (
        <div className="home-page-card">
          <div className="fade-in fade-in-delay-1 home-page-photo-container">
            {homePageData.photo && (
              <img
                className="home-page-photo"
                src={s3ImageUrl(homePageData.photo)}
                onError={onS3ImageError}
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
