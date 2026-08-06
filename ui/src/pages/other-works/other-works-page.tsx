import { useEffect, useState } from "react";
import { BlogPost } from "../../Models";
import DataList from "../../components/dataList/dataList";
import DataListItem from "../../components/dataListItem/dataListItem";
import { ContentPage } from "../../components/content-page/content-page";
import { BlogService } from "../../services/blog";
import { BlogPostSummary } from "../../components/blog-post-summary/blog-post-summary";

// Public list of blog posts. Renders one summary per published post, each
// linking to its /blog/:id permalink; full post content is only fetched on
// that detail page, so this page does a single list fetch total.
export function OtherWorksPage() {
  const [posts, setPosts] = useState<Array<BlogPost>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const getOtherWorks = async () => {
      setIsLoading(true);
      const newPosts = await BlogService.getPublicListFromS3();
      setPosts(newPosts);
      setIsLoading(false);
    };
    getOtherWorks();
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
            <BlogPostSummary
              post={post}
              showPublished={false}
              isAdmin={false}
              onClick={() => {}}
            />
          </DataListItem>
        ))}
      </DataList>
    </ContentPage>
  );
}
