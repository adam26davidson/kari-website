import { BlogService } from "../../services/blog";
import { BlogPostSummary } from "../../components/blog-post-summary/blog-post-summary";
import { PublicListPage } from "../../components/public-list-page/public-list-page";

// Public list of blog posts. Renders one summary per published post, each
// linking to its /blog/:id permalink; full post content is only fetched on
// that detail page, so this page does a single list fetch total.
export function OtherWorksPage() {
  return (
    <PublicListPage
      fetchList={BlogService.getPublicListFromS3}
      errorMessage="Failed to load posts."
      renderItem={(post) => (
        <BlogPostSummary post={post} showPublished={false} isAdmin={false} />
      )}
    />
  );
}
