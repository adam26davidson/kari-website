import { HaikuContent } from "@kari/shared/components/haiku-content/haiku-content";
import { HaikuService } from "@kari/shared/services/haiku";
import { PublicListPage } from "../../components/public-list-page/public-list-page";
import { usePreviewOverrides } from "../../preview/preview-overrides-context";

export function HaikuPage() {
  // The admin's unsaved copy, when this page is framed by her editor's
  // site preview (#859).
  const { haiku: draft } = usePreviewOverrides();
  return (
    <PublicListPage
      fetchList={HaikuService.getListFromS3}
      errorMessage="Failed to load haiku."
      draft={draft}
      renderItem={(haiku) => <HaikuContent haiku={haiku} />}
    />
  );
}
