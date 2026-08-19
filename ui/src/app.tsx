import { Header } from "./components/header/header";
import "./app.css";
import { Navigate, Route, Routes } from "react-router-dom";
import { useIsMobile } from "./hooks/use-is-mobile";
import { useSiteBackground } from "./hooks/use-site-background";
import { MobileMenu } from "./components/mobile-menu/mobile-menu";
import { Suspense, useState } from "react";
import { RouteErrorBoundary } from "./components/error-boundary/error-boundary";
import { lazyWithRetry } from "./components/error-boundary/lazy-with-retry";

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
const WhatsOnTestPage = lazyWithRetry(() =>
  import("./pages/whats-on-test/whats-on-test-page").then((m) => ({
    default: m.WhatsOnTestPage,
  })),
);

function RouteFallback() {
  return <div className="route-loading">Loading...</div>;
}

export function App() {
  const [showingMobileMenu, setShowingMobileMenu] = useState(false);
  const isMobile = useIsMobile();
  useSiteBackground();
  return (
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
                {/* Staging-only deployment status page: the flag is set in
                    .env.staging and .env.test but never .env.production,
                    so the prod bundle statically drops this route. */}
                {import.meta.env.VITE_SHOW_TEST_STATUS === "true" && (
                  <Route path="whats-on-test" element={<WhatsOnTestPage />} />
                )}
              </Routes>
            </Suspense>
          </RouteErrorBoundary>
        )}
      </div>
    </div>
  );
}
