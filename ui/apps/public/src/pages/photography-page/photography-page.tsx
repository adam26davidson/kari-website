import { PhotographyService } from "@kari/shared/services/photography";
import { PhotographyPostContent } from "./components/photography-post-content/photography-post-content";
import { PublicListPage } from "../../components/public-list-page/public-list-page";

export function PhotographyPage() {
  return (
    <PublicListPage
      fetchList={PhotographyService.getListFromS3}
      errorMessage="Failed to load photography."
      renderItem={(post) => <PhotographyPostContent post={post} />}
    />
  );
}
