import "./admin-item-list.css";
import { useState } from "react";
import {
  faArrowDown,
  faArrowUp,
  faPencil,
  faPlus,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export interface AdminItemListProps<T extends { id: string }> {
  items: Array<T>;
  renderItem: (item: T) => React.ReactNode;
  onNewItem: () => void;
  /**
   * Every item callback receives the item's id, never its position: the
   * rendered list may be a filtered subset, so an index into it would
   * silently address the wrong element of the page's full list.
   */
  onDelete: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  /** Omit to hide the edit control (pass hideEdit too for clarity). */
  onEdit?: (id: string) => void;
  hideEdit?: boolean;
  compact?: boolean;
  /**
   * Enables the search box. Returns the text a query is matched against
   * (case-insensitive substring), e.g. a haiku's joined lines + publisher.
   */
  getSearchText?: (item: T) => string;
  /** Plural noun for the search label and empty state, e.g. "haiku". */
  noun?: string;
}

/**
 * The admin list layout shared by the admin pages: an optional search box,
 * an add button, and one row per item keyed by the item's stable id, with
 * first/last aware move controls. Searching filters the list in place
 * (never re-sorts — the order is hand-curated) and hides the move controls,
 * since "up" is meaningless relative to a partial view. Forked from the
 * public DataList/DataListItem so the admin tree has no public-component
 * imports (slated for a shadcn replacement).
 */
export function AdminItemList<T extends { id: string }>({
  items,
  renderItem,
  onNewItem,
  onDelete,
  onMove,
  onEdit,
  hideEdit,
  compact,
  getSearchText,
  noun = "items",
}: AdminItemListProps<T>) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtering = !!getSearchText && needle.length > 0;
  const visibleItems = filtering
    ? items.filter((item) => getSearchText(item).toLowerCase().includes(needle))
    : items;

  return (
    <div className="admin-data-list-container">
      <div className="admin-data-list">
        {getSearchText && (
          <input
            type="search"
            className="admin-data-list-search"
            aria-label={`Search ${noun}`}
            placeholder={`Search ${noun}...`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <button
          type="button"
          className="admin-icon-button"
          aria-label="Add item"
          onClick={onNewItem}
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
        {filtering && visibleItems.length === 0 && (
          <p className="admin-data-list-empty">
            No {noun} match &quot;{query.trim()}&quot;
          </p>
        )}
        {visibleItems.map((item, idx) => (
          <div
            key={item.id}
            className={
              compact ? "admin-data-list-item compact" : "admin-data-list-item"
            }
          >
            <div className="admin-data-list-item-content">
              {renderItem(item)}
            </div>
            <div className="admin-data-list-item-controls">
              {!filtering && idx !== 0 && (
                <button
                  type="button"
                  className="admin-icon-button"
                  aria-label="Move up"
                  onClick={() => onMove(item.id, "up")}
                >
                  <FontAwesomeIcon icon={faArrowUp} />
                </button>
              )}
              {!filtering && idx !== visibleItems.length - 1 && (
                <button
                  type="button"
                  className="admin-icon-button"
                  aria-label="Move down"
                  onClick={() => onMove(item.id, "down")}
                >
                  <FontAwesomeIcon icon={faArrowDown} />
                </button>
              )}
              <button
                type="button"
                className="admin-icon-button"
                aria-label="Delete"
                onClick={() => onDelete(item.id)}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
              {!hideEdit && (
                <button
                  type="button"
                  className="admin-icon-button"
                  aria-label="Edit"
                  onClick={onEdit && (() => onEdit(item.id))}
                >
                  <FontAwesomeIcon icon={faPencil} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
