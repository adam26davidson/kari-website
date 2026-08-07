import {
  faArrowDown,
  faArrowUp,
  faTrash,
  faPencil,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

interface DataListItemProps {
  children?: React.ReactNode;
  isFirst: boolean;
  isLast: boolean;
  isAdmin: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  hideEdit?: boolean;
  compact?: boolean;
}

const DataListItem = ({
  children,
  isLast,
  isFirst,
  isAdmin,
  onMoveUp,
  onMoveDown,
  onDelete,
  onEdit,
  hideEdit,
  compact,
}: DataListItemProps) => {
  const adminClass = compact
    ? "admin-data-list-item compact"
    : "admin-data-list-item";
  return (
    <div className={isAdmin ? adminClass : "data-list-item"}>
      <div className="data-list-item-content">{children}</div>
      {isAdmin && (
        <div className="data-list-item-controls">
          {!isFirst && (
            <button
              type="button"
              className="admin-icon-button"
              aria-label="Move up"
              onClick={onMoveUp}
            >
              <FontAwesomeIcon icon={faArrowUp} />
            </button>
          )}
          {!isLast && (
            <button
              type="button"
              className="admin-icon-button"
              aria-label="Move down"
              onClick={onMoveDown}
            >
              <FontAwesomeIcon icon={faArrowDown} />
            </button>
          )}
          <button
            type="button"
            className="admin-icon-button"
            aria-label="Delete"
            onClick={onDelete}
          >
            <FontAwesomeIcon icon={faTrash} />
          </button>
          {!hideEdit && (
            <button
              type="button"
              className="admin-icon-button"
              aria-label="Edit"
              onClick={onEdit}
            >
              <FontAwesomeIcon icon={faPencil} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DataListItem;
