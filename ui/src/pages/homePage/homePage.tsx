import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "../../hooks/isMobile";
import "./homePage.css";
import { HomePageData } from "../../Models";
import { LoadError } from "../../components/load-error/load-error";
import { HomePageService } from "../../services/home-page";

const S3_URL = import.meta.env.VITE_S3_URL;

function Home() {
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [homePageData, setHomePageData] = useState<HomePageData>({
    photo: "",
    blurb: "",
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setHomePageData(await HomePageService.getFromS3());
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
                src={`${S3_URL}/images/${homePageData.photo}`}
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

export default Home;
