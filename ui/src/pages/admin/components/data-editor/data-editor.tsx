import "./data-editor.css";
import { AdminButton } from "../admin-button/admin-button";

export function DataEditor({
  children,
  /** Names what is being edited, e.g. "Edit haiku" — required so no editor
      can open as an unheaded panel of boxes (#457). */
  title,
  disableSave,
  onSave,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  disableSave?: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="data-editor">
      <div className="data-editor-content">
        <div className="data-editor-header">
          <h2 className="admin-section-heading data-editor-title">{title}</h2>
          <div className="data-editor-item-controls">
            {/* Save first and filled: the one obvious next action. It used
                to be a floppy-disk glyph, the least legible control on the
                screen (#457). */}
            <AdminButton onClick={onSave} disabled={disableSave}>
              Save
            </AdminButton>
            <AdminButton variant="secondary" onClick={onClose}>
              Close
            </AdminButton>
          </div>
        </div>
        <div className="data-list-item-inputs">{children}</div>
      </div>
    </div>
  );
}
