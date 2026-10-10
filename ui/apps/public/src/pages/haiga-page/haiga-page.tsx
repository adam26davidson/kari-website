import { HaigaContent } from "@kari/shared/components/haiga-content/haiga-content";
import { HaigaService } from "@kari/shared/services/haiga";
import { PublicListPage } from "../../components/public-list-page/public-list-page";
import { usePreviewOverrides } from "../../preview/preview-overrides-context";

export function HaigaPage() {
  // The admin's unsaved copy, when this page is framed by her editor's
  // site preview (#859).
  const { haiga: draft } = usePreviewOverrides();
  return (
    <PublicListPage
      fetchList={HaigaService.getListFromS3}
      errorMessage="Failed to load haiga."
      draft={draft}
      renderItem={(haiga) => <HaigaContent haiga={haiga} />}
    />
  );
}
