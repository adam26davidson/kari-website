import "./admin-item-list.css";
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
  renderItem: (item: T, idx: number) => React.ReactNode;
  onNewItem: () => void;
  onDelete: (idx: number) => void;
  onMove: (idx: number, direction: "up" | "down") => void;
  /** Omit to hide the edit control (pass hideEdit too for clarity). */
  onEdit?: (idx: number) => void;
  hideEdit?: boolean;
  compact?: boolean;
}

/**
 * The admin list layout shared by the admin pages: an add button plus one
 * row per item, keyed by the item's stable id, with first/last aware move
 * controls. Forked from the public DataList/DataListItem so the admin tree
 * has no public-component imports (slated for a shadcn replacement).
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
}: AdminItemListProps<T>) {
  return (
    <div className="admin-data-list-container">
      <div className="admin-data-list">
        <button
          type="button"
          className="admin-icon-button"
          aria-label="Add item"
          onClick={onNewItem}
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
        {items.map((item, idx) => (
          <div
            key={item.id}
            className={
              compact
                ? "admin-data-list-item compact"
                : "admin-data-list-item"
            }
          >
            <div className="admin-data-list-item-content">
              {renderItem(item, idx)}
            </div>
            <div className="admin-data-list-item-controls">
              {idx !== 0 && (
                <button
                  type="button"
                  className="admin-icon-button"
                  aria-label="Move up"
                  onClick={() => onMove(idx, "up")}
                >
                  <FontAwesomeIcon icon={faArrowUp} />
                </button>
              )}
              {idx !== items.length - 1 && (
                <button
                  type="button"
                  className="admin-icon-button"
                  aria-label="Move down"
                  onClick={() => onMove(idx, "down")}
                >
                  <FontAwesomeIcon icon={faArrowDown} />
                </button>
              )}
              <button
                type="button"
                className="admin-icon-button"
                aria-label="Delete"
                onClick={() => onDelete(idx)}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
              {!hideEdit && (
                <button
                  type="button"
                  className="admin-icon-button"
                  aria-label="Edit"
                  onClick={onEdit && (() => onEdit(idx))}
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
