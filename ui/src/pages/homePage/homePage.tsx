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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: isMobile ? "flex-start" : "center",
        height: "100%",
        width: "100%",
        overflowY: "auto",
      }}
    >
      {isLoading && <div>Loading...</div>}
      {!isLoading && loadFailed && (
        <LoadError message="Failed to load home page." onRetry={load} />
      )}
      {!isLoading && !loadFailed && (
        <div
          style={{
            backgroundColor: "rgba(226, 226, 226, 0.8)",
            backdropFilter: "blur(10px)",
            display: "flex",
            flexDirection: !isMobile ? "row" : "column",
            alignItems: "center",
            justifyContent: "center",
            width: "calc(80% - 16px)",
            maxWidth: "800px",
            padding: "30px",
            margin: "8px",
            borderRadius: "3px",
          }}
        >
          <div
            className="fade-in"
            style={{
              minWidth: isMobile ? "300px" : "400px",
              padding: "20px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {homePageData.photo && (
              <img
                style={{ maxHeight: "400px" }}
                src={`${S3_URL}/images/${homePageData.photo}`}
              />
            )}
          </div>
          <div
            className="fade-in"
            style={{
              width: "0px",
              borderLeft: "1px solid #bbb",
              height: "90%",
              margin: "0 30px",
            }}
          ></div>
          <div
            className="fade-in"
            style={{
              maxWidth: "500px",
              padding: "20px",
              color: "black",
            }}
          >
            {homePageData.blurb}
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;
