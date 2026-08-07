import { useParams } from "react-router-dom";
import { ContentPage } from "../../components/content-page/content-page";
import { OtherWorksItem } from "../other-works/components/other-works-item/other-works-item";

// Detail page for a single blog post, routed at /blog/:id. This is the
// target of the permalinks on the "Other works" page (and of the
// BlogPostSummary links); it reuses OtherWorksItem, which owns the fetch
// and renders its own loading / not-found / error states along with the
// post's title, date, and sanitized content.
export function BlogPostPage() {
  const { id } = useParams();
  return (
    <ContentPage>
      <OtherWorksItem id={id || ""} />
    </ContentPage>
  );
}
