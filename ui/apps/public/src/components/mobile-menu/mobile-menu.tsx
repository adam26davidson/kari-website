import { Link, useLocation } from "react-router";
import "@kari/shared/styles/mobile-menu.css";
import { PAGES } from "@kari/shared/constants";

export function MobileMenu({
  setShowingMobileMenu,
}: {
  setShowingMobileMenu: (showing: boolean) => void;
}) {
  const location = useLocation();
  return (
    <div className="mobile-menu">
      {PAGES.map((page) => (
        <Link
          key={page.path}
          to={page.path}
          className={
            "mobile-menu-item" +
            (location.pathname === page.path ? " active" : "")
          }
          onClick={() => setShowingMobileMenu(false)}
        >
          {page.name}
        </Link>
      ))}
      {/* Plain anchor, like the desktop header's: /admin is a separate
          application, so it is a full page load rather than a client-side
          navigation. Without it the admin section is unreachable on a
          phone, where the nav bar is collapsed into this menu. */}
      <a href="/admin" className="mobile-menu-item">
        Admin
      </a>
    </div>
  );
}
