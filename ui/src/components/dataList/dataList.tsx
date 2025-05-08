/* eslint-disable react-hooks/exhaustive-deps */
import "./dataList.css";
import "../dataListItem/dataListItem.css";
import "../../pages/admin/admin.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";

interface DataListProps {
  children?: React.ReactNode[];
  isAdmin: boolean;
  onNewItem: () => void;
}

function DataList({ children, isAdmin, onNewItem }: DataListProps) {
  return (
    <>
      <div className="data-list-container">
        <div className={isAdmin ? "admin-data-list" : "data-list fade-in"}>
          {isAdmin && (
            <div className="admin-icon-button" onClick={onNewItem}>
              <FontAwesomeIcon icon={faPlus} />
            </div>
          )}
          {children?.map((child: React.ReactNode, idx: number) => (
            <>
              {child}
              {idx !== children.length - 1 && !isAdmin && (
                <div className="data-list-item-separator" />
              )}
            </>
          ))}
        </div>
      </div>
    </>
  );
}

export default DataList;
