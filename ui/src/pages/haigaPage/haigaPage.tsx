import "./haigaPage.css";
import { useEffect, useState } from "react";
import { Haiga } from "../../Models";
import DataList from "../../components/dataList/dataList";
import { HaigaContent } from "../../components/haigaContent/haigaContent";

const S3_URL = import.meta.env.VITE_S3_URL;

export function HaigaPage() {
  const [haigaList, setHaigaList] = useState<Array<Haiga>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // get haiga from s3
    const getHaiga = async () => {
      setIsLoading(true);
      const response = await fetch(`${S3_URL}/haiga.json`);
      if (!response.ok) {
        console.error("Failed to fetch haiga", response.status);
        console.error("error", response);
        return;
      }
      const data = await response.json();
      console.log(data);
      setHaigaList(data);
      setIsLoading(false);
    };
    getHaiga();
  }, []);

  return (
    <div className="haiga-container">
      <DataList<Haiga>
        dataList={haigaList}
        isLoading={isLoading}
        isAdmin={false}
        itemContent={(idx: number) => (
          <HaigaContent haigaList={haigaList} idx={idx} />
        )}
      />
    </div>
  );
}
