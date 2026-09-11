import {
  faArrowDown,
  faArrowUp,
  faMagnifyingGlass,
  faPencil,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useSearchParams } from "react-router";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PageTitle } from "../page-title/page-title";

/**
 * The query lives in the URL rather than in component state so it survives
 * the trip through an editor (which unmounts the list) and so a filtered
 * view can be bookmarked or shared.
 */
const SEARCH_PARAM = "q";

export interface ItemListProps<T extends { id: string }> {
  items: Array<T>;
  renderItem: (item: T) => React.ReactNode;
  /** The section's name ("Haiku"), matching its sidebar link, so the page
      says where she is rather than opening with a bare search field. */
  title: string;
  onNewItem: () => void;
  /**
   * The add button's visible text, in the site's vocabulary — "Add a
   * haiku", not a bare "+". Required, so no list can ship with a generic
   * or invisible add affordance (#457).
   */
  addLabel: string;
  /**
   * Every item callback receives the item's id, never its position: the
   * rendered list may be a filtered subset, so an index into it would
   * silently address the wrong element of the page's full list.
   */
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  /**
   * Enables the search box. Returns the text a query is matched against
   * (case-insensitive substring), e.g. a haiku's joined lines + publisher.
   */
  getSearchText: (item: T) => string;
  /** Plural noun for the search label and empty state, e.g. "haiku". */
  noun: string;
}

/**
 * A migrated admin list PAGE: the section's title, a search box beside the
 * page's one filled Add button, and one hairline-divided row per item with
 * first/last aware move controls.
 *
 * The Tailwind/shadcn replacement for `components/admin-item-list` (#234),
 * which keeps the same behavior — searching filters in place (never
 * re-sorts; the order is hand-curated) and hides the move controls, since
 * "up" is meaningless relative to a partial view — and the same `?q=`
 * handling. The two exist side by side until the last legacy list migrates
 * and the fork dies (#235-#238, #240).
 *
 * Narrower than the fork on purpose: the fork's `compact`, `addVariant`,
 * `deleteLabel` and `hideEdit` are all for the photography editor's NESTED
 * image list, which is #236's problem. A prop nothing on this page can
 * reach is a branch nothing tests.
 *
 * The boards (`HaikuList`, `HaikuTablet`, `HaikuListMobile`) put the search
 * and Add inside the card's header row from `sm` up and on the paper above
 * the card at phone width. That is ONE DOM tree with responsive classes,
 * never two behind breakpoint hiding: a second "Add a haiku" in the
 * document would break both the page tests' singular `getByRole` and the
 * e2e journeys' strict mode.
 */
export function ItemList<T extends { id: string }>({
  items,
  renderItem,
  title,
  onNewItem,
  addLabel,
  onEdit,
  onDelete,
  onMove,
  getSearchText,
  noun,
}: ItemListProps<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get(SEARCH_PARAM) ?? "";
  // Typing replaces the current history entry instead of pushing one, so
  // the back button leaves the list rather than undoing keystrokes.
  const setQuery = (value: string) =>
    setSearchParams(
      (params) => {
        if (value) {
          params.set(SEARCH_PARAM, value);
        } else {
          params.delete(SEARCH_PARAM);
        }
        return params;
      },
      { replace: true },
    );
  const needle = query.trim().toLowerCase();
  const filtering = needle.length > 0;
  const visibleItems = filtering
    ? items.filter((item) => getSearchText(item).toLowerCase().includes(needle))
    : items;

  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-col gap-4 sm:gap-6">
      <PageTitle>{title}</PageTitle>
      {/* The card, from `sm` up. At phone width it spends no chrome at
          all, so the search and Add stand on the paper and only the rows
          below are on white — `HaikuListMobile.png`. */}
      <div className="sm:border-border sm:bg-card flex flex-col gap-4 sm:gap-0 sm:rounded-xl sm:border sm:shadow-[0_1px_2px_rgba(74,62,40,0.06),0_8px_24px_rgba(74,62,40,0.06)]">
        <div className="flex flex-col gap-2 sm:px-6 sm:pt-6 sm:pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="relative sm:flex-1">
              {/* Decorative: the field's accessible name is its
                  aria-label, and a magnifying glass adds nothing to it. */}
              <FontAwesomeIcon
                icon={faMagnifyingGlass}
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
              />
              <Input
                type="search"
                className="pl-10"
                aria-label={`Search ${noun}`}
                placeholder={`Search ${noun}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {/* The page's one filled button, and full width on a phone so
                it lands where her thumb is (design brief §2). */}
            <Button className="w-full sm:w-auto" onClick={onNewItem}>
              {addLabel}
            </Button>
          </div>
          {filtering && visibleItems.length > 0 && (
            <p className="text-muted-foreground font-sans text-sm">
              Showing {visibleItems.length} of {items.length} {noun}
            </p>
          )}
        </div>
        {/* The rows. A card of their own at phone width (see above), and
            just the inside of the one card from `sm` up. */}
        <div className="border-border bg-card divide-border divide-y rounded-xl border px-5 shadow-[0_1px_2px_rgba(74,62,40,0.06),0_8px_24px_rgba(74,62,40,0.06)] sm:rounded-none sm:border-0 sm:bg-transparent sm:px-6 sm:pb-2 sm:shadow-none">
          {/* Two ways for the list to come up empty, and they want opposite
              answers. A section with nothing in it used to render nothing at
              all between the search box and the add button — a bare gap where
              the brief asks for an explanation and the one action that fills
              it (#473, design brief §7). An unmatched query keeps its own
              notice, but only once there IS something to have missed:
              blaming the search on an empty section would send her looking
              for a spelling mistake. */}
          {items.length === 0 && (
            <p className="text-muted-foreground py-6 font-sans text-sm">
              No {noun} yet. Add your first one.
            </p>
          )}
          {items.length > 0 && filtering && visibleItems.length === 0 && (
            <p className="text-muted-foreground py-6 font-sans text-sm">
              No {noun} match &quot;{query.trim()}&quot;
            </p>
          )}
          {visibleItems.map((item, idx) => (
            // `admin-data-list-item` is not styling — admin.css and
            // admin-item-list.css both opt out of it through
            // `:not([data-slot="list-row"])`. It is how the e2e journeys
            // find a row (e2e/helpers.ts).
            <div
              key={item.id}
              data-slot="list-row"
              className="admin-data-list-item flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div className="min-w-0 sm:flex-1">{renderItem(item)}</div>
              {/* Order matters: edit (the one she reaches for most) first,
                  delete last and in the danger maroon.

                  Edit and delete say what they do. A pencil-in-a-circle and
                  a bin-in-a-circle were the only affordance offered for the
                  two most consequential things she can do to a row, and the
                  admin's one user does not read icons as vocabulary (#457,
                  design brief §3). The move arrows stay icons —
                  directional, low-consequence, and "Move up" is what the
                  arrow already says. */}
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <Button
                  variant="secondary"
                  className="max-sm:h-11"
                  onClick={() => onEdit(item.id)}
                >
                  <FontAwesomeIcon icon={faPencil} />
                  Edit
                </Button>
                {!filtering && idx !== 0 && (
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Move up"
                    onClick={() => onMove(item.id, "up")}
                  >
                    <FontAwesomeIcon icon={faArrowUp} />
                  </Button>
                )}
                {!filtering && idx !== visibleItems.length - 1 && (
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Move down"
                    onClick={() => onMove(item.id, "down")}
                  >
                    <FontAwesomeIcon icon={faArrowDown} />
                  </Button>
                )}
                {/* Outlined, not filled: maroon says "this destroys
                    something" while the weight stays secondary, so the
                    page's one filled button remains the thing she came to
                    do. Set further off than the controls sit from each
                    other (`ml-4` on top of the row's `gap-2`), because the
                    brief asks that a destructive action never be the
                    closest thing to the action she reaches for most (§2).
                    The legacy stylesheet said this in a margin rule of its
                    own; migrated, it is said here. */}
                <Button
                  variant="dangerSecondary"
                  className="ml-4 max-sm:h-11"
                  onClick={() => onDelete(item.id)}
                >
                  <FontAwesomeIcon icon={faTrash} />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
