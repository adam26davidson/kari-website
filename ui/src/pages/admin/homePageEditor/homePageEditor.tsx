import { useEffect, useState } from "react";
import { Card } from "../../../components/card/card";
import { HaikuEditor } from "../../../components/haikuEditor/haikuEditor";
import "./homePageEditor.css";
import { useAuth0 } from "@auth0/auth0-react";
import { HomePageData } from "../../../Models";

const API_URL = import.meta.env.VITE_API_URL;
const HOME_PAGE_DATA_ENDPOINT = `${API_URL}/home-page`;

export interface HomePageEditorProps {
  setLoading: (loading: { isLoading: boolean; message: string }) => void;
  isLoading: boolean;
}

export function HomePageEditor({ setLoading, isLoading }: HomePageEditorProps) {
  const [homePageData, setHomePageData] = useState<HomePageData>({
    featuredHaiku: {
      lines: [],
      publisher: "",
      id: "",
    },
    blurb: "",
  });
  const { getAccessTokenSilently } = useAuth0();

  useEffect(() => {
    const fetchHomePageData = async () => {
      setLoading({
        isLoading: true,
        message: "Loading home page data...",
      });
      const token = await getAccessTokenSilently();
      const response = await fetch(HOME_PAGE_DATA_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data: HomePageData = await response.json();
      console.log(data);
      setHomePageData(data);
      setLoading({ isLoading: false, message: "" });
    };
    fetchHomePageData();
  }, [getAccessTokenSilently, setLoading]);

  const saveData = async () => {
    setLoading({
      isLoading: true,
      message: "Updating home page data...",
    });
    const token = await getAccessTokenSilently();
    const response = await fetch(HOME_PAGE_DATA_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(homePageData),
    });
    const responseBody = await response.json();
    console.log(responseBody);
    setLoading({ isLoading: false, message: "" });
  };

  return (
    !isLoading && (
      <div className="home-page-editor-container">
        <div className="home-page-editor">
          <Card>
            <div className="home-page-editor-card-content">
              <div className="home-page-editor-haiku">
                <HaikuEditor
                  newHaiku={homePageData.featuredHaiku}
                  setNewHaiku={(haiku) => {
                    setHomePageData({
                      ...homePageData,
                      featuredHaiku: haiku,
                    });
                  }}
                />
              </div>
              <div className="home-page-editor-blurb">
                <textarea
                  value={homePageData.blurb}
                  placeholder="Blurb"
                  onChange={(e) => {
                    setHomePageData({
                      ...homePageData,
                      blurb: e.target.value,
                    });
                  }}
                />
              </div>
              <div>
                <button
                  className="admin-button"
                  style={{ marginLeft: "10px" }}
                  onClick={saveData}
                >
                  Save
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    )
  );
}
