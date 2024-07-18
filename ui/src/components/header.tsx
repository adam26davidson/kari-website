import { Link, useLocation } from "react-router-dom";
import "./header.css";

const pages = [
  { name: "Home", path: "/" },
  { name: "Haiku", path: "/haiku" },
  { name: "Haiga", path: "/haiga" },
  { name: "Blog", path: "/blog" },
];

function Header() {
  const location = useLocation();

  return (
    <>
    <div className="header">
      <div className="header-title">Kari Davidson</div>
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
    </div>
    <div className="header-separator"></div>
    </>
  );
}

export default Header;
