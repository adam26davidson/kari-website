import "./dataList.css";
import "../dataListItem/dataListItem.css";
import "../../pages/admin/admin.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { isValidElement } from "react";
import { Fragment } from "react/jsx-runtime";

interface DataListProps {
  children?: React.ReactNode[];
  isAdmin: boolean;
  /** Add-item handler; only meaningful (and only rendered) when isAdmin. */
  onNewItem?: () => void;
}

function DataList({ children, isAdmin, onNewItem }: DataListProps) {
  return (
    <>
      <div className="data-list-container">
        {/* fade-in-delay-1 keeps the 0.2s delay the list previously got
            from homePage.css's position-based .fade-in:nth-child(1) rule
            (this div is the container's first child). */}
        <div
          className={
            isAdmin ? "admin-data-list" : "data-list fade-in fade-in-delay-1"
          }
        >
          {isAdmin && (
            <button
              type="button"
              className="admin-icon-button"
              aria-label="Add item"
              onClick={onNewItem}
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
          )}
          {children?.map((child: React.ReactNode, idx: number) => (
            // Reconcile by the child's own key (a stable id supplied by the
            // caller) so reordering or deleting items doesn't remount or
            // mismatch state; fall back to the index for unkeyed children.
            <Fragment
              key={isValidElement(child) && child.key != null ? child.key : idx}
            >
              {child}
              {idx !== children.length - 1 && !isAdmin && (
                <div className="data-list-item-separator" />
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </>
  );
}

export default DataList;
