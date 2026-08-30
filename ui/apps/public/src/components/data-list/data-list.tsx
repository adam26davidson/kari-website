import "./data-list.css";
import { isValidElement } from "react";
import { Fragment } from "react/jsx-runtime";

interface DataListProps {
  children?: React.ReactNode;
}

/**
 * The public list card: renders its children with a separator between
 * consecutive items. The admin pages use their own AdminItemList instead.
 * A single child (the blog permalink page) gets the same card with no
 * separator, so every public page shares one translucent surface.
 */
export function DataList({ children }: DataListProps) {
  const items = Array.isArray(children)
    ? children
    : children == null
      ? []
      : [children];
  return (
    <div className="data-list-container">
      {/* fade-in-delay-1 keeps the 0.2s delay the list previously got
          from home-page.css's position-based .fade-in:nth-child(1) rule
          (this div is the container's first child). */}
      <div className="data-list fade-in fade-in-delay-1">
        {items.map((child: React.ReactNode, idx: number) => (
          // Reconcile by the child's own key (a stable id supplied by the
          // caller) so reordering or deleting items doesn't remount or
          // mismatch state; fall back to the index for unkeyed children.
          <Fragment
            key={isValidElement(child) && child.key != null ? child.key : idx}
          >
            {child}
            {idx !== items.length - 1 && (
              <div className="data-list-item-separator" />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
