import { useEffect, useState } from "react";
import { PhotographyPost } from "../../Models";
import DataList from "../../components/dataList/dataList";
import DataListItem from "../../components/dataListItem/dataListItem";
import { PhotographyService } from "../../services/photography";
import { ContentPage } from "../../components/content-page/content-page";
import { PhotographyPostContent } from "./components/photography-post-content/photography-post-content";

export function PhotographyPage() {
  const [postList, setPostList] = useState<Array<PhotographyPost>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // get photography posts from s3
    const getPosts = async () => {
      setIsLoading(true);
      const data = await PhotographyService.getListFromS3();
      setPostList(data);
      setIsLoading(false);
    };
    getPosts();
  }, []);

  return (
    <ContentPage isLoading={isLoading}>
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
    </ContentPage>
  );
}
