import { useParams } from "react-router";
import { ContentPage } from "../../components/content-page/content-page";
import { DataList } from "../../components/data-list/data-list";
import { OtherWorksItem } from "../other-works/components/other-works-item/other-works-item";

// Detail page for a single blog post, routed at /blog/:id. This is the
// target of the permalinks on the "Other works" page (and of the
// BlogPostSummary links); it reuses OtherWorksItem, which owns the fetch
// and renders its own loading / not-found / error states along with the
// post's title, date, and sanitized content. The DataList card is the
// same translucent surface the list page uses; without it the post sat
// directly on the background photo and was illegible (#410).
export function BlogPostPage() {
  const { id } = useParams();
  return (
    <ContentPage>
      <DataList>
        <OtherWorksItem id={id || ""} />
      </DataList>
    </ContentPage>
  );
}
