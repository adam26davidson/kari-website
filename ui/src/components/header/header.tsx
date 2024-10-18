import { Link, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import "./header.css";
import { faUser } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const pages = [
  { name: "Home", path: "/" },
  { name: "Haiku", path: "/haiku" },
  { name: "Haiga", path: "/haiga" },
  { name: "Blog", path: "/blog" },
];

function Header() {
  const location = useLocation();
  const { user, isAuthenticated, isLoading, logout } = useAuth0();

  return (
    <>
      <div className="header">
        <div className="header-title">
          {"Kari Davidson" + (location.pathname === "/admin" ? " - Admin" : "")}
        </div>
        {location.pathname !== "/admin" && (
          <div className="pages">
            {pages.map((page) => (
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
                onClick={() =>
                  logout({ logoutParams: { returnTo: window.location.origin } })
                }
              >
                Log Out
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
