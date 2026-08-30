import { Header } from "./components/header/header";
import "./app.css";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useIsMobile } from "./hooks/use-is-mobile";
import { useSiteBackground } from "./hooks/use-site-background";
import { MobileMenu } from "./components/mobile-menu/mobile-menu";
import { Suspense, useState } from "react";
import { RouteErrorBoundary } from "./components/error-boundary/error-boundary";
import { lazyWithRetry } from "./components/error-boundary/lazy-with-retry";
import { AdminAuthProvider } from "./auth/lazy-admin-auth";
import { isAdminPath } from "./utils/admin-routes";

// Route-level code splitting: each page loads as its own chunk, so
// visitors never download the admin section (and its tiptap editor
// stack) unless they navigate to /admin. lazyWithRetry retries a
// failed chunk fetch and auto-reloads once after a redeploy replaces
// the hashed chunk files (see lazy-with-retry.ts / issue #107).
const Home = lazyWithRetry(() =>
  import("./pages/home-page/home-page").then((m) => ({
    default: m.Home,
  })),
);
const HaikuPage = lazyWithRetry(() =>
  import("./pages/haiku-page/haiku-page").then((m) => ({
    default: m.HaikuPage,
  })),
);
const HaigaPage = lazyWithRetry(() =>
  import("./pages/haiga-page/haiga-page").then((m) => ({
    default: m.HaigaPage,
  })),
);
const OtherWorksPage = lazyWithRetry(() =>
  import("./pages/other-works/other-works-page").then((m) => ({
    default: m.OtherWorksPage,
  })),
);
const BlogPostPage = lazyWithRetry(() =>
  import("./pages/blog-post/blog-post-page").then((m) => ({
    default: m.BlogPostPage,
  })),
);
const PhotographyPage = lazyWithRetry(() =>
  import("./pages/photography-page/photography-page").then((m) => ({
    default: m.PhotographyPage,
  })),
);
const Admin = lazyWithRetry(() =>
  import("./pages/admin/admin").then((m) => ({
    default: m.Admin,
  })),
);
function RouteFallback() {
  return <div className="route-loading">Loading...</div>;
}

export function App() {
  const [showingMobileMenu, setShowingMobileMenu] = useState(false);
  const isMobile = useIsMobile();
  const isAdminRoute = isAdminPath(useLocation().pathname);
  useSiteBackground();
  const shell = (
    <div className="whole-page">
      <Header
        showingMobileMenu={showingMobileMenu}
        setShowingMobileMenu={setShowingMobileMenu}
      />
      <div className="content">
        {isMobile && showingMobileMenu && (
          <MobileMenu setShowingMobileMenu={setShowingMobileMenu} />
        )}
        {!showingMobileMenu && (
          <RouteErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="haiku" element={<HaikuPage />} />
                <Route path="haiga" element={<HaigaPage />} />
                <Route path="other-works" element={<OtherWorksPage />} />
                <Route
                  path="blog"
                  element={<Navigate to="/other-works" replace />}
                />
                <Route path="blog/:id" element={<BlogPostPage />} />
                <Route path="admin/*" element={<Admin />} />
                <Route path="photography" element={<PhotographyPage />} />
              </Routes>
            </Suspense>
          </RouteErrorBoundary>
        )}
      </div>
    </div>
  );

  // The Auth0 session boundary is mounted only for admin routes, and from
  // a lazy chunk, so public visitors never download the SDK (issue #272).
  // It wraps the whole shell because the header renders the signed-in user
  // outside the route outlet. The cost is one extra round trip before
  // /admin paints -- admin-only, and the section is maintainer-facing.
  //
  // The RouteErrorBoundary has to sit ABOVE this Suspense: it is the one lazy chunk
  // fetched from outside the shell, so the shell's own RouteErrorBoundary
  // is below it and cannot catch a persistent load failure. Uncaught, that
  // error escapes App to the data router in main.tsx -- which declares no
  // errorElement -- instead of the chunk-load prompt from #107.
  if (!isAdminRoute) return shell;
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <AdminAuthProvider>{shell}</AdminAuthProvider>
      </Suspense>
    </RouteErrorBoundary>
  );
}
