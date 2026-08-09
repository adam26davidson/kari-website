import DataList from "../dataList/dataList";
import DataListItem from "../dataListItem/dataListItem";

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
 * DataListItem per item, keyed by the item's stable id, with first/last
 * aware move controls.
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
    <DataList isAdmin={true} onNewItem={onNewItem}>
      {items.map((item, idx) => (
        <DataListItem
          key={item.id}
          isAdmin={true}
          compact={compact}
          isFirst={idx === 0}
          isLast={idx === items.length - 1}
          onEdit={onEdit && (() => onEdit(idx))}
          onDelete={() => onDelete(idx)}
          onMoveUp={() => onMove(idx, "up")}
          onMoveDown={() => onMove(idx, "down")}
          hideEdit={hideEdit}
        >
          {renderItem(item, idx)}
        </DataListItem>
      ))}
    </DataList>
  );
}
