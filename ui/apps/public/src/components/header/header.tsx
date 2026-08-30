import { Link, useLocation } from "react-router";
import "@kari/shared/styles/header.css";
import { faBars } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { PAGES } from "@kari/shared/constants";

export function Header({
  showingMobileMenu,
  setShowingMobileMenu,
}: {
  showingMobileMenu: boolean;
  setShowingMobileMenu: (showing: boolean) => void;
}) {
  const location = useLocation();
  const isMobile = useIsMobile();

  return (
    <div className="header">
      {isMobile && (
        <button
          type="button"
          aria-label="Menu"
          className="header-menu-button"
          onClick={() => setShowingMobileMenu(!showingMobileMenu)}
        >
          <FontAwesomeIcon icon={faBars} className="header-menu-icon" />
        </button>
      )}
      <div className={isMobile ? "header-title-mobile" : "header-title"}>
        Kari Davidson
      </div>
      {!isMobile && (
        <div className="pages">
          {PAGES.map((page) => (
            <Link
              key={page.path}
              to={page.path}
              className={location.pathname === page.path ? "active" : ""}
            >
              {page.name}
            </Link>
          ))}
          {/* A plain anchor, not a router Link: /admin is a different
              application (its own build, its own bundle), so following it
              has to be a full page load rather than a client-side
              navigation this router could never resolve. */}
          <a href="/admin">Admin</a>
        </div>
      )}
    </div>
  );
}
