import {
  faArrowDown,
  faArrowUp,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Card } from "../card/card";

interface DataListItemProps {
  children?: React.ReactNode;
  idx: number;
  isFirst: boolean;
  isLast: boolean;
  isAdmin: boolean;
  moveItem: (idx: number, direction: "up" | "down") => () => void;
  deleteItem: () => void;
}

const DataListItem = ({
  children,
  idx,
  isLast,
  isFirst,
  isAdmin,
  moveItem,
  deleteItem,
}: DataListItemProps) => {
  return (
    <Card>
      <div className="data-list-item-content">{children}</div>
      {isAdmin && (
        <div className="data-list-item-controls">
          {!isFirst && (
            <div className="admin-icon-button" onClick={moveItem(idx, "up")}>
              <FontAwesomeIcon icon={faArrowUp} />
            </div>
          )}
          {!isLast && (
            <div className="admin-icon-button" onClick={moveItem(idx, "down")}>
              <FontAwesomeIcon icon={faArrowDown} />
            </div>
          )}
          <div className="admin-icon-button" onClick={deleteItem}>
            <FontAwesomeIcon icon={faTrash} />
          </div>
        </div>
      )}
    </Card>
  );
};

export default DataListItem;
