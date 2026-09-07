import { Link, useLocation } from "react-router";
import "@kari/shared/styles/mobile-menu.css";
import { MOBILE_MENU_ID, PAGES } from "@kari/shared/constants";

export function MobileMenu({
  setShowingMobileMenu,
}: {
  setShowingMobileMenu: (showing: boolean) => void;
}) {
  const location = useLocation();
  return (
    // The id is what the header's hamburger names in aria-controls (#502).
    <div id={MOBILE_MENU_ID} className="mobile-menu">
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
      {/* No /admin entry here either — see header.tsx. */}
    </div>
  );
}
