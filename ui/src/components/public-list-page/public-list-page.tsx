import { ReactNode } from "react";
import DataList from "../dataList/dataList";
import DataListItem from "../dataListItem/dataListItem";
import { ContentPage } from "../content-page/content-page";
import { LoadError } from "../load-error/load-error";
import { useS3Load } from "../../hooks/useS3Load";

interface PublicListPageProps<T extends { id: string }> {
  /** Stable fetcher, e.g. a static service method (see useS3Load). */
  fetchList: () => Promise<Array<T>>;
  /** Shown with a Retry button when the fetch fails. */
  errorMessage: string;
  /** Renders one item's content; each item is keyed by its `id`. */
  renderItem: (item: T) => ReactNode;
}

/**
 * Shared scaffolding for the public list pages (haiku, haiga, other
 * works, photography): loads a list from S3 on mount and renders one
 * DataListItem per entry. When the fetch fails it renders a retryable
 * LoadError instead of the list, so an outage is never mistaken for a
 * legitimately empty page.
 */
export function PublicListPage<T extends { id: string }>({
  fetchList,
  errorMessage,
  renderItem,
}: PublicListPageProps<T>) {
  const {
    data: items,
    isLoading,
    loadFailed,
    load,
  } = useS3Load(fetchList, []);

  return (
    <ContentPage isLoading={isLoading}>
      {loadFailed ? (
        <LoadError message={errorMessage} onRetry={load} />
      ) : (
        <DataList isAdmin={false}>
          {items.map((item, idx) => (
            <DataListItem
              key={item.id}
              isAdmin={false}
              isLast={idx === items.length - 1}
              isFirst={idx === 0}
            >
              {renderItem(item)}
            </DataListItem>
          ))}
        </DataList>
      )}
    </ContentPage>
  );
}
