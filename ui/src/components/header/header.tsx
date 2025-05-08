import { Link, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import "./header.css";
import {
  faUser,
  faBars,
  faRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useIsMobile } from "../../hooks/isMobile";
import { PAGES } from "../../constants";

function Header({
  showingMobileMenu,
  setShowingMobileMenu,
}: {
  showingMobileMenu: boolean;
  setShowingMobileMenu: (showing: boolean) => void;
}) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const { user, isAuthenticated, isLoading, logout } = useAuth0();
  const isAdminPage = location.pathname === "/admin";

  return (
    <>
      <div className={isAdminPage ? "admin-header" : "header"}>
        {isMobile && (
          <FontAwesomeIcon
            icon={faBars}
            className="header-menu-icon"
            onClick={() => setShowingMobileMenu(!showingMobileMenu)}
          />
        )}
        <div
          className={
            isMobile
              ? "header-title-mobile"
              : (isAdminPage ? "admin-" : "") + "header-title"
          }
        >
          {"Kari Davidson" + (location.pathname === "/admin" ? " - Admin" : "")}
        </div>
        {location.pathname !== "/admin" && !isMobile && (
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
        {location.pathname === "/admin" && isAuthenticated && !isLoading && (
          <>
            <div className="header-user-section">
              <FontAwesomeIcon icon={faUser} />
              <div className="header-user-name">{user?.name}</div>
              <button
                className="header-logout"
                onClick={() =>
                  logout({ logoutParams: { returnTo: window.location.origin } })
                }
              >
                <FontAwesomeIcon icon={faRightFromBracket} />
              </button>
            </div>
          </>
        )}
        {location.pathname == "/admin" && isLoading && "Logging in..."}
      </div>
    </>
  );
}

export default Header;
