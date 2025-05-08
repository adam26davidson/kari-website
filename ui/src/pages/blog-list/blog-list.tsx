import { useEffect, useState } from "react";
import { BlogPost } from "../../Models";
import DataList from "../../components/dataList/dataList";
import DataListItem from "../../components/dataListItem/dataListItem";
import { ContentPage } from "../../components/content-page/content-page";
import { BlogPostSummary } from "../../components/blog-post-summary/blog-post-summary";
import { BlogService } from "../../services/blog";

export function BlogList() {
  const [posts, setPosts] = useState<Array<BlogPost>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // get haiku from s3
    const getHaiku = async () => {
      setIsLoading(true);
      const newPosts = await BlogService.getPublicListFromS3();
      setPosts(newPosts);
      setIsLoading(false);
    };
    getHaiku();
  }, []);

  return (
    <ContentPage isLoading={isLoading}>
      <DataList isAdmin={false} onNewItem={() => {}}>
        {posts.map((post, idx) => (
          <DataListItem
            key={post.id}
            isAdmin={false}
            isLast={idx === posts.length - 1}
            isFirst={idx === 0}
          >
            <BlogPostSummary post={post} showPublished={false} />
          </DataListItem>
        ))}
      </DataList>
    </ContentPage>
  );
}
