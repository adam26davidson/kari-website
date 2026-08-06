import { useCallback, useEffect, useState } from "react";
import { Haiga } from "../../Models";
import DataList from "../../components/dataList/dataList";
import { HaigaContent } from "../../components/haigaContent/haigaContent";
import DataListItem from "../../components/dataListItem/dataListItem";
import { HaigaService } from "../../services/haiga";
import { ContentPage } from "../../components/content-page/content-page";
import { LoadError } from "../../components/load-error/load-error";

export function HaigaPage() {
  const [haigaList, setHaigaList] = useState<Array<Haiga>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setHaigaList(await HaigaService.getListFromS3());
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
    <ContentPage isLoading={isLoading}>
      {loadFailed ? (
        <LoadError message="Failed to load haiga." onRetry={load} />
      ) : (
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
      )}
    </ContentPage>
  );
}
