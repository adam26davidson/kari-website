import "@kari/shared/styles/header.css";
import { faBars } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { HeaderUserSection } from "../../auth/admin-auth";

/**
 * The admin bar. A fork of the public site's header rather than one shared
 * component behind a flag: this one always renders the admin chrome, shows
 * the signed-in user, and its nav (the mobile menu) leaves the app, while
 * the public one routes inside it. The stylesheet is still shared, so the
 * two bars cannot drift apart visually while they are meant to match
 * (#591); the admin restyle in #592 is where they part company.
 */
export function Header({
  showingMobileMenu,
  setShowingMobileMenu,
}: {
  showingMobileMenu: boolean;
  setShowingMobileMenu: (showing: boolean) => void;
}) {
  const isMobile = useIsMobile();

  return (
    <div className="admin-header">
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
      <div className={isMobile ? "header-title-mobile" : "admin-header-title"}>
        Kari Davidson - Admin
      </div>
      <HeaderUserSection />
    </div>
  );
}
