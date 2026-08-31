import "./load-error.css";
import { SiteButton } from "../site-button/site-button";

interface LoadErrorProps {
  message: string;
  onRetry: () => void;
}

/**
 * Shown when a page (admin or public) fails to load its data, with a
 * Retry action. On admin pages it replaces the editor entirely: editing
 * must never start from unloaded data, or a save would overwrite the real
 * content. On public pages it replaces the content so a fetch failure is
 * never mistaken for an empty page. The neutral card styling (and
 * SiteButton, a plain styled button) suits both contexts.
 */
export function LoadError({ message, onRetry }: LoadErrorProps) {
  return (
    <div className="load-error">
      <p>{message}</p>
      <SiteButton onClick={onRetry}>Retry</SiteButton>
    </div>
  );
}
