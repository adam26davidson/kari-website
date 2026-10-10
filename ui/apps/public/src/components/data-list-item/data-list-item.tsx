import { Ref } from "react";
import "./data-list-item.css";

interface DataListItemProps {
  children?: React.ReactNode;
  /** On the outer element — how a list page scrolls one entry into view. */
  ref?: Ref<HTMLDivElement>;
}

/** One entry in the public DataList. No admin controls — the admin pages
 * render their own list rows (apps/admin/src/components/item-list). */
export const DataListItem = ({ children, ref }: DataListItemProps) => {
  return (
    <div className="data-list-item" ref={ref}>
      <div className="data-list-item-content">{children}</div>
    </div>
  );
};
