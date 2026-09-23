import "./load-error.css";
import { SiteButton } from "../site-button/site-button";

interface LoadErrorProps {
  message: string;
  onRetry: () => void;
}

/**
 * Shown when a public page fails to load its data, with a Retry action. It
 * replaces the content, so a fetch failure is never mistaken for an empty
 * page. The neutral card styling (and SiteButton, a plain styled button)
 * belongs to the public site's visual language.
 *
 * Public-only since #832. The admin pages that used to render this have
 * their own at apps/admin/src/components/load-error/, built on shadcn —
 * this one's card would arrive on the admin's paper as a floating slab
 * under a black shadow. Nothing here is shared with it; change this one
 * for the public site's sake alone.
 */
export function LoadError({ message, onRetry }: LoadErrorProps) {
  return (
    <div className="load-error">
      <p>{message}</p>
      <SiteButton onClick={onRetry}>Retry</SiteButton>
    </div>
  );
}
