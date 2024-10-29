import {
  faArrowDown,
  faArrowUp,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

interface EditorListItemProps {
  children?: React.ReactNode;
  idx: number;
  isFirst: boolean;
  isLast: boolean;
  moveItem: (idx: number, direction: "up" | "down") => () => void;
  deleteItem: () => void;
}

const EditorListItem = ({
  children,
  idx,
  isLast,
  isFirst,
  moveItem,
  deleteItem,
}: EditorListItemProps) => {
  return (
    <div className="editor-list-item">
      <div className="editor-list-item-content">{children}</div>
      <div className="editor-list-item-controls">
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
    </div>
  );
};

export default EditorListItem;
