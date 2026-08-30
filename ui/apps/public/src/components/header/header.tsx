import { Suspense } from "react";
import { Link, useLocation } from "react-router";
import "./header.css";
import { faBars } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useIsMobile } from "../../hooks/use-is-mobile";
import { PAGES } from "../../constants";
import { isAdminPath } from "../../utils/admin-routes";
import { HeaderUserSection } from "../../auth/lazy-admin-auth";

export function Header({
  showingMobileMenu,
  setShowingMobileMenu,
}: {
  showingMobileMenu: boolean;
  setShowingMobileMenu: (showing: boolean) => void;
}) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const isAdminPage = isAdminPath(location.pathname);

  return (
    <div className={isAdminPage ? "admin-header" : "header"}>
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
      <div
        className={
          isMobile
            ? "header-title-mobile"
            : isAdminPage
              ? "admin-header-title"
              : "header-title"
        }
      >
        {"Kari Davidson" + (isAdminPage ? " - Admin" : "")}
      </div>
      {!isAdminPage && !isMobile && (
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
        </div>
      )}
      {/* Admin-only, and lazy: the user section is the header's sole
          Auth0 consumer, so keeping it in its own chunk keeps the SDK off
          every public page. The chunk is already in flight by the time
          this renders -- the app shell mounts AdminAuthProvider from the
          same module -- so the null fallback is momentary. */}
      {isAdminPage && (
        <Suspense fallback={null}>
          <HeaderUserSection />
        </Suspense>
      )}
    </div>
  );
}
