import { Link, useLocation } from "react-router-dom";
import "./mobileMenu.css";
import { PAGES } from "../../constants";

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
    </div>
  );
}
