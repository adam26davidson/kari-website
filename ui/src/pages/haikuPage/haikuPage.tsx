import { useCallback, useEffect, useState } from "react";
import { Haiku } from "../../Models";
import DataList from "../../components/dataList/dataList";
import { HaikuContent } from "../../components/haikuContent/haikuContent";
import DataListItem from "../../components/dataListItem/dataListItem";
import { ContentPage } from "../../components/content-page/content-page";
import { HaikuService } from "../../services/haiku";
import { LoadError } from "../../components/load-error/load-error";

export function HaikuPage() {
  const [haikuList, setHaikuList] = useState<Array<Haiku>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setHaikuList(await HaikuService.getListFromS3());
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
        <LoadError message="Failed to load haiku." onRetry={load} />
      ) : (
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
      )}
    </ContentPage>
  );
}
