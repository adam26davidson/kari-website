import "./site-button.css";

/**
 * The public-side styled button (header logout, load-error retry). Forked
 * from the admin's pre-shadcn button so no public component imports from
 * the admin tree; the admin's own button is shadcn/Tailwind since #592, and
 * this is now the only holder of the old look.
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
