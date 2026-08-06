import { useCallback, useEffect, useState } from "react";
import { BlogPost } from "../../Models";
import DataList from "../../components/dataList/dataList";
import DataListItem from "../../components/dataListItem/dataListItem";
import { ContentPage } from "../../components/content-page/content-page";
import { BlogService } from "../../services/blog";
import { BlogPostSummary } from "../../components/blog-post-summary/blog-post-summary";
import { LoadError } from "../../components/load-error/load-error";

// Public list of blog posts. Renders one summary per published post, each
// linking to its /blog/:id permalink; full post content is only fetched on
// that detail page, so this page does a single list fetch total.
export function OtherWorksPage() {
  const [posts, setPosts] = useState<Array<BlogPost>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setPosts(await BlogService.getPublicListFromS3());
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
        <LoadError message="Failed to load posts." onRetry={load} />
      ) : (
        <DataList isAdmin={false} onNewItem={() => {}}>
          {posts.map((post, idx) => (
            <DataListItem
              key={post.id}
              isAdmin={false}
              isLast={idx === posts.length - 1}
              isFirst={idx === 0}
            >
              <BlogPostSummary
                post={post}
                showPublished={false}
                isAdmin={false}
                onClick={() => {}}
              />
            </DataListItem>
          ))}
        </DataList>
      )}
    </ContentPage>
  );
}
