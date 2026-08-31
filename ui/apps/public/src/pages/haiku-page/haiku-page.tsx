import { HaikuContent } from "@kari/shared/components/haiku-content/haiku-content";
import { HaikuService } from "@kari/shared/services/haiku";
import { PublicListPage } from "../../components/public-list-page/public-list-page";

export function HaikuPage() {
  return (
    <PublicListPage
      fetchList={HaikuService.getListFromS3}
      errorMessage="Failed to load haiku."
      renderItem={(haiku) => <HaikuContent haiku={haiku} />}
    />
  );
}
