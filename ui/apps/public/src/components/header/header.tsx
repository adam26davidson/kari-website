import { Link, useLocation } from "react-router";
import "@kari/shared/styles/header.css";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { MOBILE_MENU_ID, PAGES } from "@kari/shared/constants";

// This is Font Awesome's faBars path, rendered directly because it is the
// public app's only icon. Pulling the FontAwesomeIcon renderer into every
// visitor's entry chunk costs far more than the path it draws.
const MENU_ICON_PATH =
  "M0 96C0 78.3 14.3 64 32 64l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 128C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32L32 448c-17.7 0-32-14.3-32-32s14.3-32 32-32l384 0c17.7 0 32 14.3 32 32z";

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
          <svg
            aria-hidden="true"
            className="header-menu-icon"
            height="1em"
            viewBox="0 0 448 512"
            width="1.25em"
          >
            <path fill="currentColor" d={MENU_ICON_PATH} />
          </svg>
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
