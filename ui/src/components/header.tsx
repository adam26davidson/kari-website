import { Link, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import "./header.css";

const pages = [
  { name: "Home", path: "/" },
  { name: "Haiku", path: "/haiku" },
  { name: "Haiga", path: "/haiga" },
  { name: "Blog", path: "/blog" },
];

function Header() {
  const location = useLocation();
  const { user, isAuthenticated, isLoading, logout } = useAuth0();
  const { loginWithRedirect } = useAuth0();

  return (
    <>
      <div className="header">
        <div className="header-title">Kari Davidson</div>
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
        {location.pathname === "/admin" && !isAuthenticated && !isLoading && (
          <button className="login-button" onClick={() => loginWithRedirect()}>
            Log In
          </button>
        )}
        {location.pathname === "/admin" && isAuthenticated && !isLoading && (
          <>
            "{user?.given_name}"
            <button
              onClick={() =>
                logout({ logoutParams: { returnTo: window.location.origin } })
              }
            >
              Log Out
            </button>
          </>
        )}
        {location.pathname == "/admin" && isLoading && "Logging in..."}
      </div>
      {/* <div className="header-separator"></div> */}
    </>
  );
}

export default Header;
