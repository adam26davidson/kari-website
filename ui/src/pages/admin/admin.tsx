import "./admin.css";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AdminHaikuPage } from "./admin-haiku-page/admin-haiku-page";
import { useAuth0 } from "@auth0/auth0-react";
import { AdminHaigaPage } from "./admin-haiga-page/admin-haiga-page";
import { HomePageEditor } from "./home-page-editor/home-page-editor";
import { AdminOtherWorksPage } from "./admin-other-works-page/admin-other-works-page";
import { AdminPhotographyPage } from "./admin-photography-page/admin-photography-page";
import { AdminImageGcPage } from "./admin-image-gc-page/admin-image-gc-page";
import { AdminBackgroundPage } from "./admin-background-page/admin-background-page";
import { AdminButton } from "../../components/admin-button/admin-button";
import { AdminUiProvider } from "./admin-ui-provider";

// Single source of truth for the admin menu: ids (also the URL segment
// under /admin), order, and labels.
const ADMIN_PAGES = [
  { id: "home", label: "Home" },
  { id: "haiku", label: "Haiku" },
  { id: "haiga", label: "Haiga" },
  { id: "photography", label: "Photography" },
  { id: "other-works", label: "Other works" },
  { id: "background", label: "Background" },
  { id: "image-cleanup", label: "Image cleanup" },
] as const;

export function Admin() {
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
              <NavLink
                key={id}
                to={`/admin/${id}`}
                className={({ isActive }) =>
                  `admin-menu-item ${isActive ? "selected" : ""}`
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
          <div className="admin-content">
            <AdminUiProvider>
              <Routes>
                <Route path="home" element={<HomePageEditor />} />
                <Route path="haiku/:id?" element={<AdminHaikuPage />} />
                <Route path="haiga/:id?" element={<AdminHaigaPage />} />
                <Route
                  path="photography/:id?"
                  element={<AdminPhotographyPage />}
                />
                <Route
                  path="other-works/:id?"
                  element={<AdminOtherWorksPage />}
                />
                <Route path="background" element={<AdminBackgroundPage />} />
                <Route path="image-cleanup" element={<AdminImageGcPage />} />
                <Route
                  path="*"
                  element={<Navigate to="/admin/home" replace />}
                />
              </Routes>
            </AdminUiProvider>
          </div>
        </>
      )}
    </div>
  );
}
