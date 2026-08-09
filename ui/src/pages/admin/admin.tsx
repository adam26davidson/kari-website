import { useState } from "react";
import "./admin.css";
import AdminHaikuPage from "./adminHaikuPage/adminHaikuPage";
import { useAuth0 } from "@auth0/auth0-react";
import AdminHaigaPage from "./adminHaigaPage/adminHaigaPage";
import { HomePageEditor } from "./homePageEditor/homePageEditor";
import { AdminOtherWorksPage } from "./adminOtherWorksPage/admin-other-works-page";
import { AdminPhotographyPage } from "./admin-photography-page/admin-photography-page";
import { AdminImageGcPage } from "./admin-image-gc-page/admin-image-gc-page";
import { AdminButton } from "../../components/admin-button/admin-button";
import { AdminUiProvider } from "./admin-ui-provider";

// Single source of truth for the admin menu: ids, order, and labels.
const ADMIN_PAGES = [
  { id: "home", label: "Home" },
  { id: "haiku", label: "Haiku" },
  { id: "haiga", label: "Haiga" },
  { id: "photography", label: "Photography" },
  { id: "other-works", label: "Other works" },
  { id: "image-cleanup", label: "Image cleanup" },
] as const;

type Page = (typeof ADMIN_PAGES)[number]["id"];

function Admin() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();

  return (
    <div className="admin-container">
      {!isAuthenticated && !isLoading && (
        <AdminButton onClick={() => loginWithRedirect()}>Log In</AdminButton>
      )}
      {isAuthenticated && !isLoading && (
        <>
          <div className="admin-menu">
            {ADMIN_PAGES.map(({ id, label }) => (
              <div
                key={id}
                className={`admin-menu-item ${
                  currentPage === id ? "selected" : ""
                }`}
                onClick={() => setCurrentPage(id)}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="admin-content">
            <AdminUiProvider>
              {currentPage === "home" && <HomePageEditor />}
              {currentPage === "haiku" && <AdminHaikuPage />}
              {currentPage === "haiga" && <AdminHaigaPage />}
              {currentPage === "other-works" && <AdminOtherWorksPage />}
              {currentPage === "photography" && <AdminPhotographyPage />}
              {currentPage === "image-cleanup" && <AdminImageGcPage />}
            </AdminUiProvider>
          </div>
        </>
      )}
    </div>
  );
}

export default Admin;
