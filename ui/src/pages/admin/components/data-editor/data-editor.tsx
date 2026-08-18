import { faClose, faFloppyDisk } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import "./data-editor.css";

export function DataEditor({
  children,
  disableSave,
  onSave,
  onClose,
}: {
  children: React.ReactNode;
  disableSave?: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="data-editor">
      <div className="data-editor-content">
        <div className="data-editor-item-controls">
          <button
            type="button"
            className={`admin-icon-button${disableSave ? " disabled" : ""}`}
            disabled={disableSave}
            aria-label="Save"
            onClick={onSave}
          >
            <FontAwesomeIcon icon={faFloppyDisk} />
          </button>
          <button
            type="button"
            className="admin-icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faClose} />
          </button>
        </div>
        <div className="data-list-item-inputs">{children}</div>
      </div>
    </div>
  );
}
