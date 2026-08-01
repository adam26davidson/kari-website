import "./load-error.css";
import { AdminButton } from "../admin-button/admin-button";

interface LoadErrorProps {
  message: string;
  onRetry: () => void;
}

/**
 * Shown when an admin page fails to load its data. Replaces the editor
 * entirely: editing must never start from unloaded data, or a save would
 * overwrite the real content.
 */
export function LoadError({ message, onRetry }: LoadErrorProps) {
  return (
    <div className="load-error">
      <p>{message}</p>
      <AdminButton onClick={onRetry}>Retry</AdminButton>
    </div>
  );
}
