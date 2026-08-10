import { HaigaContent } from "../../components/haiga-content/haiga-content";
import { HaigaService } from "../../services/haiga";
import { PublicListPage } from "../../components/public-list-page/public-list-page";

export function HaigaPage() {
  return (
    <PublicListPage
      fetchList={HaigaService.getListFromS3}
      errorMessage="Failed to load haiga."
      renderItem={(haiga) => <HaigaContent haiga={haiga} />}
    />
  );
}
