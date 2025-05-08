import { useEffect, useState } from "react";
import { Haiga } from "../../Models";
import DataList from "../../components/dataList/dataList";
import { HaigaContent } from "../../components/haigaContent/haigaContent";
import DataListItem from "../../components/dataListItem/dataListItem";
import { HaigaService } from "../../services/haiga";
import { ContentPage } from "../../components/content-page/content-page";

export function HaigaPage() {
  const [haigaList, setHaigaList] = useState<Array<Haiga>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // get haiga from s3
    const getHaiga = async () => {
      setIsLoading(true);
      const data = await HaigaService.getListFromS3();
      setHaigaList(data);
      setIsLoading(false);
    };
    getHaiga();
  }, []);

  return (
    <ContentPage isLoading={isLoading}>
      <DataList isAdmin={false} onNewItem={() => {}}>
        {haigaList.map((haiga, idx) => (
          <DataListItem
            key={haiga.id}
            isAdmin={false}
            isLast={idx === haigaList.length - 1}
            isFirst={idx === 0}
          >
            <HaigaContent haiga={haiga} />
          </DataListItem>
        ))}
      </DataList>
    </ContentPage>
  );
}
