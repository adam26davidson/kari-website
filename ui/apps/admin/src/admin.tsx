import "./admin.css";
import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import {
  BookOpen,
  Camera,
  FlaskConical,
  House,
  Image,
  Palette,
  PenLine,
  Sparkles,
} from "lucide-react";
import { AdminHaikuPage } from "./admin-haiku-page/admin-haiku-page";
import { useAuth0 } from "@auth0/auth0-react";
import { AdminHaigaPage } from "./admin-haiga-page/admin-haiga-page";
import { HomePageEditor } from "./home-page-editor/home-page-editor";
import { AdminOtherWorksPage } from "./admin-other-works-page/admin-other-works-page";
import { AdminPhotographyPage } from "./admin-photography-page/admin-photography-page";
import { AdminImageGcPage } from "./admin-image-gc-page/admin-image-gc-page";
import { AdminBackgroundPage } from "./admin-background-page/admin-background-page";
import { AdminButton } from "./components/admin-button/admin-button";
import { AdminUiProvider } from "./admin-ui-provider";
import { AppShell } from "./components/app-shell/app-shell";
import type { AdminPage } from "./components/app-shell/admin-page";
import { Wordmark } from "./components/app-shell/wordmark";
import { lazyWithRetry } from "@kari/shared/components/error-boundary/lazy-with-retry";

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
// under /admin), order, labels, and — since #592 — the stroke icon each
// section wears. The icon is not decoration: at tablet width the shell
// collapses to a 72px rail where the glyph is all there is to tell one
// section from another.
const ADMIN_PAGES: readonly AdminPage[] = [
  { id: "home", label: "Home", icon: House },
  { id: "haiku", label: "Haiku", icon: PenLine },
  { id: "haiga", label: "Haiga", icon: Image },
  { id: "photography", label: "Photography", icon: Camera },
  { id: "other-works", label: "Other works", icon: BookOpen },
  // The route segment stays "background" — it is bookmarked, and
  // e2e/screenshots.mjs captures it by path — while the label says what
  // the page now covers: the photo, the header colours and the fonts.
  { id: "background", label: "Appearance", icon: Palette },
  { id: "image-cleanup", label: "Image cleanup", icon: Sparkles },
];

export function Admin() {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  // Read at render time (not module scope) so tests can stub the env var;
  // Vite still inlines the value, so the condition folds away in prod.
  const showTestStatus = import.meta.env.VITE_SHOW_TEST_STATUS === "true";
  const pages: readonly AdminPage[] = showTestStatus
    ? [
        ...ADMIN_PAGES,
        { id: "whats-on-test", label: "What's on test", icon: FlaskConical },
      ]
    : ADMIN_PAGES;

  // Signed out, or still asking Auth0 whether she is. One screen for both:
  // the wordmark carries the page's <h1> in every state, so the document
  // never has an outline that starts at level 2 (#504), and the line under
  // it changes rather than the page.
  if (!isAuthenticated) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-background px-6 text-center">
        <Wordmark className="text-[28px]" />
        <p className="max-w-xs font-sans text-sm text-muted-foreground">
          {isLoading
            ? "Just a moment — checking whether you are already signed in."
            : "Your workshop is behind a sign-in, so only you can change the site."}
        </p>
        {!isLoading && (
          <AdminButton onClick={() => loginWithRedirect()}>Log In</AdminButton>
        )}
      </div>
    );
  }

  return (
    <AppShell pages={pages}>
      <AdminUiProvider>
        <Routes>
          <Route path="home" element={<HomePageEditor />} />
          <Route path="haiku/:id?" element={<AdminHaikuPage />} />
          <Route path="haiga/:id?" element={<AdminHaigaPage />} />
          <Route path="photography/:id?" element={<AdminPhotographyPage />} />
          <Route path="other-works/:id?" element={<AdminOtherWorksPage />} />
          <Route path="background" element={<AdminBackgroundPage />} />
          <Route path="image-cleanup" element={<AdminImageGcPage />} />
          {showTestStatus && (
            <Route
              path="whats-on-test"
              element={
                // Local boundary: keep the shell in place while the page's
                // lazy chunk loads.
                <Suspense fallback={<div className="loading">Loading...</div>}>
                  <AdminWhatsOnTestPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </AdminUiProvider>
    </AppShell>
  );
}
