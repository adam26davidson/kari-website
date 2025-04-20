import "./haikuPage.css";
// import HaikuZenViewer from "../../components/haikuZenViewer/haikuZenviewer";
import { useEffect, useState } from "react";
import { Haiku } from "../../Models";
import DataList from "../../components/dataList/dataList";
import { HaikuContent } from "../../components/haikuContent/haikuContent";

const S3_URL = import.meta.env.VITE_S3_URL;

export function HaikuPage() {
  const [haikuList, setHaikuList] = useState<Array<Haiku>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // get haiku from s3
    const getHaiku = async () => {
      setIsLoading(true);
      const response = await fetch(`${S3_URL}/haiku.json`);
      if (!response.ok) {
        console.error("Failed to fetch haiku", response.status);
        console.error("error", response);
        return;
      }
      const data = await response.json();
      console.log(data);
      setHaikuList(data);
      setIsLoading(false);
    };
    getHaiku();
  }, []);

  return (
    <div className="haiku-container">
      <DataList<Haiku>
        dataList={haikuList}
        isLoading={isLoading}
        isAdmin={false}
        itemContent={(idx: number) => (
          <HaikuContent haikuList={haikuList} idx={idx} />
        )}
      />
    </div>
  );
}
