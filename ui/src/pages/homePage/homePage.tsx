import { useEffect, useState } from "react";
import { HaikuContent } from "../../components/haikuContent/haikuContent";
import { useIsMobile } from "../../hooks/isMobile";
import "./homePage.css";

const featuredHaiku = {
  id: "0",
  title: "Featured Haiku",
  lines: ["autumn sunset", "all that glitters", "is gold"],
  publisher: "Mainichi Japan, 10/24/17",
};

const blurb =
  'This haiku represents, to me, a simple wonder at what is--which basically, is the essence of haiku!  As we grow older (as implied in "autumn sunset"), hopefully we start to shed our fools\' gold and see more of the real stuff that\'s been glowing all around us all along. What has changed is not the sunset, but our eyes, now seeing what is most valuable, content with the glow of a sunset. The old wise saying "all that glitters isn\'t gold" is no longer relevant!  And maybe we become children again.';

const S3_URL = import.meta.env.VITE_S3_URL;

function Home() {
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(false);
  const [homePageData, setHomePageData] = useState({
    featuredHaiku: featuredHaiku,
    blurb: blurb,
  });

  useEffect(() => {
    // get haiku from s3
    const fetchData = async () => {
      setIsLoading(true);
      const response = await fetch(`${S3_URL}/home-page.json`);
      if (!response.ok) {
        console.error("Failed to fetch home page data", response.status);
        console.error("error", response);
        return;
      }
      const data = await response.json();
      console.log(data);
      setHomePageData(data);
      setIsLoading(false);
    };
    fetchData();
  }, []);

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
      {!isLoading && (
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
              minWidth: "200px",
              padding: "20px",
            }}
          >
            <HaikuContent haikuList={[homePageData.featuredHaiku]} idx={0} />
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
