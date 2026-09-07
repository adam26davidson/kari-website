import { Link, useLocation } from "react-router";
import "@kari/shared/styles/header.css";
import { faBars } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { MOBILE_MENU_ID, PAGES } from "@kari/shared/constants";

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
        // aria-controls only while the menu is open: app.tsx mounts it on
        // demand, and the attribute may only name an element that is in the
        // document. aria-expanded carries the state either way.
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={showingMobileMenu}
          aria-controls={showingMobileMenu ? MOBILE_MENU_ID : undefined}
          className="header-menu-button"
          onClick={() => setShowingMobileMenu(!showingMobileMenu)}
        >
          <FontAwesomeIcon icon={faBars} className="header-menu-icon" />
        </button>
      )}
      {/* The site title is the page's <h1> (#504). None of the public pages
          declares a heading of its own, so as a <div> this left home, haiku,
          haiga, photography and other-works with no level-1 heading at all.
          header.css states the size, weight and margin an <h1> would
          otherwise take from the browser, so only the outline changes. */}
      <h1 className={isMobile ? "header-title-mobile" : "header-title"}>
        Kari Davidson
      </h1>
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
          {/* Deliberately no link to /admin: the admin app is reached by
              typing its URL. It exists for two people, and a visible entry
              on the public site advertises it to every visitor. */}
        </div>
      )}
    </div>
  );
}
