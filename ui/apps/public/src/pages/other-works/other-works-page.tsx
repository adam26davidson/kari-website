import { BlogService } from "@kari/shared/services/blog";
import { BlogPostSummary } from "@kari/shared/components/blog-post-summary/blog-post-summary";
import { PublicListPage } from "../../components/public-list-page/public-list-page";
import { usePreviewOverrides } from "../../preview/preview-overrides-context";

// Public list of blog posts. Renders one summary per published post, each
// linking to its /blog/:id permalink; full post content is only fetched on
// that detail page, so this page does a single list fetch total.
export function OtherWorksPage() {
  // The post the admin is editing, when her editor's site preview frames
  // this page (#1053). It is listed whatever `isPublished` says, as
  // OtherWorksItem renders it: a new post starts unpublished, and the pane
  // must show it before she decides to publish.
  const { blogPost: draft } = usePreviewOverrides();
  return (
    <PublicListPage
      fetchList={BlogService.getPublicListFromS3}
      errorMessage="Failed to load posts."
      draft={draft}
      renderItem={(post) => (
        <BlogPostSummary post={post} />
      )}
    />
  );
}
