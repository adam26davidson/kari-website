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
}: DataListItemProps) => {
  return (
    <div className={isAdmin ? "admin-data-list-item" : "data-list-item"}>
      <div className="data-list-item-content">{children}</div>
      {isAdmin && (
        <div className="data-list-item-controls">
          {!isFirst && (
            <div className="admin-icon-button" onClick={onMoveUp}>
              <FontAwesomeIcon icon={faArrowUp} />
            </div>
          )}
          {!isLast && (
            <div className="admin-icon-button" onClick={onMoveDown}>
              <FontAwesomeIcon icon={faArrowDown} />
            </div>
          )}
          <div className="admin-icon-button" onClick={onDelete}>
            <FontAwesomeIcon icon={faTrash} />
          </div>
          <div className="admin-icon-button" onClick={onEdit}>
            <FontAwesomeIcon icon={faPencil} />
          </div>
        </div>
      )}
    </div>
  );
};

export default DataListItem;
