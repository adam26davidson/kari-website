import { useState } from "react";
import "./admin.css";
import HaikuEditor from "./haikuEditor/haikuEditor";

type Page = "home" | "haiku" | "haiga" | "blog";

function Haiku() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  return (
    <>
      <div className="admin-container">
        <div className="admin-menu">
          {["home", "haiku", "haiga", "blog"].map((page) => (
            <div
              key={page}
              className={`admin-menu-item ${
                currentPage === page ? "selected" : ""
              }`}
              onClick={() => setCurrentPage(page as Page)}
            >
              {page.charAt(0).toUpperCase() + page.slice(1)}
            </div>
          ))}
        </div>
        <div className="admin-content">
          {currentPage === "home" && <div>Home</div>}
          {currentPage === "haiku" && <HaikuEditor />}
          {currentPage === "haiga" && <div>Haiga</div>}
          {currentPage === "blog" && <div>Blog</div>}
        </div>
      </div>
    </>
  );
}

export default Haiku;
