import { Header } from "./components/header/header";
import "@kari/shared/styles/app.css";
import { Navigate, Route, Routes } from "react-router";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { useSiteBackground } from "@kari/shared/hooks/use-site-background";
import { MobileMenu } from "./components/mobile-menu/mobile-menu";
import { Suspense, useState } from "react";
import { RouteErrorBoundary } from "@kari/shared/components/error-boundary/error-boundary";
import { lazyWithRetry } from "@kari/shared/components/error-boundary/lazy-with-retry";

// Route-level code splitting: each page loads as its own chunk.
// lazyWithRetry retries a failed chunk fetch and auto-reloads once after a
// redeploy replaces the hashed chunk files (see lazy-with-retry.ts /
// issue #107).
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
function RouteFallback() {
  return <div className="route-loading">Loading...</div>;
}

export function App() {
  const [showingMobileMenu, setShowingMobileMenu] = useState(false);
  const isMobile = useIsMobile();
  useSiteBackground();
  // No /admin route and no Auth0 boundary: the admin section is a separate
  // app served under /admin (issue #591), reached from the header by a plain
  // link that leaves this SPA.
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
                <Route path="photography" element={<PhotographyPage />} />
              </Routes>
            </Suspense>
          </RouteErrorBoundary>
        )}
      </div>
    </div>
  );
}
