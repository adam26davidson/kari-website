import { useEffect, useState } from "react";
import { Haiku } from "../../Models";
import DataList from "../../components/dataList/dataList";
import { HaikuContent } from "../../components/haikuContent/haikuContent";
import DataListItem from "../../components/dataListItem/dataListItem";
import { ContentPage } from "../../components/content-page/content-page";

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
    <ContentPage isLoading={isLoading}>
      <DataList isAdmin={false} onNewItem={() => {}}>
        {haikuList.map((haiku, idx) => (
          <DataListItem
            key={haiku.id}
            isAdmin={false}
            isLast={idx === haikuList.length - 1}
            isFirst={idx === 0}
          >
            <HaikuContent haiku={haiku} />
          </DataListItem>
        ))}
      </DataList>
    </ContentPage>
  );
}
