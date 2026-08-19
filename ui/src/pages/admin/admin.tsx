import "./admin.css";
import { Suspense } from "react";
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
import { lazyWithRetry } from "../../components/error-boundary/lazy-with-retry";

// Staging-only section (VITE_SHOW_TEST_STATUS is set in .env.staging and
// .env.test, never .env.production). Lazy, unlike the other admin pages:
// the render-time flag checks below fold to `false` in the prod bundle, so
// the page's chunk is never requested there — a static import would ship
// its code and CSS inside the admin chunk regardless.
const AdminWhatsOnTestPage = lazyWithRetry(() =>
  import("./admin-whats-on-test-page/admin-whats-on-test-page").then((m) => ({
    default: m.AdminWhatsOnTestPage,
  })),
);

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
  // Read at render time (not module scope) so tests can stub the env var;
  // Vite still inlines the value, so the condition folds away in prod.
  const showTestStatus = import.meta.env.VITE_SHOW_TEST_STATUS === "true";
  const pages: ReadonlyArray<{ id: string; label: string }> = showTestStatus
    ? [...ADMIN_PAGES, { id: "whats-on-test", label: "What's on test" }]
    : ADMIN_PAGES;

  return (
    <div className="admin-container">
      {!isAuthenticated && !isLoading && (
        <AdminButton onClick={() => loginWithRedirect()}>Log In</AdminButton>
      )}
      {isAuthenticated && !isLoading && (
        <>
          <div className="admin-menu">
            {pages.map(({ id, label }) => (
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
                {showTestStatus && (
                  <Route
                    path="whats-on-test"
                    element={
                      // Local boundary: keep the admin menu in place
                      // while the page's lazy chunk loads.
                      <Suspense
                        fallback={<div className="loading">Loading...</div>}
                      >
                        <AdminWhatsOnTestPage />
                      </Suspense>
                    }
                  />
                )}
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
