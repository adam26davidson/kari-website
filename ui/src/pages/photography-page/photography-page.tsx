import { useCallback, useEffect, useState } from "react";
import { PhotographyPost } from "../../Models";
import DataList from "../../components/dataList/dataList";
import DataListItem from "../../components/dataListItem/dataListItem";
import { PhotographyService } from "../../services/photography";
import { ContentPage } from "../../components/content-page/content-page";
import { PhotographyPostContent } from "./components/photography-post-content/photography-post-content";
import { LoadError } from "../../components/load-error/load-error";

export function PhotographyPage() {
  const [postList, setPostList] = useState<Array<PhotographyPost>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setPostList(await PhotographyService.getListFromS3());
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
        <LoadError message="Failed to load photography." onRetry={load} />
      ) : (
        <DataList isAdmin={false} onNewItem={() => {}}>
          {postList.map((post, idx) => (
            <DataListItem
              key={post.id}
              isAdmin={false}
              isLast={idx === postList.length - 1}
              isFirst={idx === 0}
            >
              <PhotographyPostContent post={post} />
            </DataListItem>
          ))}
        </DataList>
      )}
    </ContentPage>
  );
}
