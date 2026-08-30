import { HaikuContent } from "../../components/haiku-content/haiku-content";
import { HaikuService } from "../../services/haiku";
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
