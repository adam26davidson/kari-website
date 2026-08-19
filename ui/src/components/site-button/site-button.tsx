import "./site-button.css";

/**
 * The public-side styled button (header logout, load-error retry). A
 * straight fork of the admin tree's AdminButton so no public component
 * imports from the admin tree; the styling is identical.
 */
export function SiteButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="site-button">
      {children}
    </button>
  );
}
