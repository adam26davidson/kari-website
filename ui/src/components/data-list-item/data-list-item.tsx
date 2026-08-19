import "./data-list-item.css";

interface DataListItemProps {
  children?: React.ReactNode;
}

/** One entry in the public DataList. No admin controls — the admin pages
 * render their own AdminItemList. */
export const DataListItem = ({ children }: DataListItemProps) => {
  return (
    <div className="data-list-item">
      <div className="data-list-item-content">{children}</div>
    </div>
  );
};
