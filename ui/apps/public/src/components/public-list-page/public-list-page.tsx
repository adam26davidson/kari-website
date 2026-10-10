import { ReactNode, useEffect, useMemo, useRef } from "react";
import { DataList } from "../data-list/data-list";
import { DataListItem } from "../data-list-item/data-list-item";
import { ContentPage } from "../content-page/content-page";
import { LoadError } from "@kari/shared/components/load-error/load-error";
import { useS3Load } from "@kari/shared/hooks/use-s3-load";
import { replaceOrAppendById } from "@kari/shared/utils/data-list-helpers";

interface PublicListPageProps<T extends { id: string }> {
  /** Stable fetcher, e.g. a static service method (see useS3Load). */
  fetchList: () => Promise<Array<T>>;
  /** Shown with a Retry button when the fetch fails. */
  errorMessage: string;
  /** Renders one item's content; each item is keyed by its `id`. */
  renderItem: (item: T) => ReactNode;
  /**
   * The admin's unsaved copy of one item, from the in-editor site preview
   * (#859): spliced into the loaded list by id, or appended when the list
   * does not have it yet.
   */
  draft?: T;
}

/**
 * Shared scaffolding for the public list pages (haiku, haiga, other
 * works, photography): loads a list from S3 on mount and renders one
 * DataListItem per entry. When the fetch fails it renders a retryable
 * LoadError instead of the list, so an outage is never mistaken for a
 * legitimately empty page.
 *
 * In the admin's preview pane a `draft` stands in for its deployed entry,
 * in the entry's own place — not moved to the top, not shown alone, since
 * the pane exists to show the page as a visitor would see it. The draft
 * can be the fortieth item, so the page scrolls to it when it first
 * appears. A failed fetch still shows the error: the draft is one item,
 * and the page is the list.
 */
export function PublicListPage<T extends { id: string }>({
  fetchList,
  errorMessage,
  renderItem,
  draft,
}: PublicListPageProps<T>) {
  const {
    data: items,
    isLoading,
    loadFailed,
    load,
  } = useS3Load(fetchList, []);

  // Memoised so every entry keeps its identity between renders: item
  // components key effects on their item's fields (photography's object
  // URLs), and a fresh splice per render would re-run them.
  const shown = useMemo(
    () => (draft ? replaceOrAppendById(items, draft) : items),
    [items, draft],
  );

  const draftRef = useRef<HTMLDivElement>(null);
  const draftId = draft?.id;
  // Keyed on the id, not the draft: she is typing into it, and the pane
  // jumping back to her item on every keystroke would fight her scrolling.
  useEffect(() => {
    if (draftId === undefined || isLoading) return;
    draftRef.current?.scrollIntoView({ block: "start" });
  }, [draftId, isLoading]);

  return (
    <ContentPage isLoading={isLoading}>
      {loadFailed ? (
        <LoadError message={errorMessage} onRetry={load} />
      ) : (
        <DataList>
          {shown.map((item) => (
            <DataListItem
              key={item.id}
              ref={item.id === draftId ? draftRef : undefined}
            >
              {renderItem(item)}
            </DataListItem>
          ))}
        </DataList>
      )}
    </ContentPage>
  );
}
