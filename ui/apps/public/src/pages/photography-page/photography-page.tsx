import { PhotographyService } from "@kari/shared/services/photography";
import { PhotographyPostContent } from "./components/photography-post-content/photography-post-content";
import { PublicListPage } from "../../components/public-list-page/public-list-page";
import { usePreviewOverrides } from "../../preview/preview-overrides-context";

export function PhotographyPage() {
  // The admin's unsaved copy, when this page is framed by her editor's
  // site preview (#859).
  const { photographyPost: draft } = usePreviewOverrides();
  return (
    <PublicListPage
      fetchList={PhotographyService.getListFromS3}
      errorMessage="Failed to load photography."
      draft={draft}
      renderItem={(post) => <PhotographyPostContent post={post} />}
    />
  );
}
