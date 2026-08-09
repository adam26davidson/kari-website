import Header from "./components/header/header";
import "./App.css";
import { Navigate, Route, Routes } from "react-router-dom";
import { useIsMobile } from "./hooks/isMobile";
import { MobileMenu } from "./components/mobileMenu/mobileMenu";
import { Suspense, useState } from "react";
import { RouteErrorBoundary } from "./components/error-boundary/error-boundary";
import { lazyWithRetry } from "./components/error-boundary/lazy-with-retry";

// Route-level code splitting: each page loads as its own chunk, so
// visitors never download the admin section (and its tiptap editor
// stack) unless they navigate to /admin. lazyWithRetry retries a
// failed chunk fetch and auto-reloads once after a redeploy replaces
// the hashed chunk files (see lazy-with-retry.ts / issue #107).
const Home = lazyWithRetry(() => import("./pages/homePage/homePage"));
const HaikuPage = lazyWithRetry(() =>
  import("./pages/haikuPage/haikuPage").then((m) => ({
    default: m.HaikuPage,
  })),
);
const HaigaPage = lazyWithRetry(() =>
  import("./pages/haigaPage/haigaPage").then((m) => ({
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
const Admin = lazyWithRetry(() => import("./pages/admin/admin"));

function RouteFallback() {
  return <div className="route-loading">Loading...</div>;
}

function App() {
  const [showingMobileMobileMenu, setShowingMobileMenu] = useState(false);
  const isMobile = useIsMobile();
  return (
    <div className="whole-page">
      <Header
        showingMobileMenu={showingMobileMobileMenu}
        setShowingMobileMenu={setShowingMobileMenu}
      />
      <div className="content">
        {isMobile && showingMobileMobileMenu && (
          <MobileMenu setShowingMobileMenu={setShowingMobileMenu} />
        )}
        {!showingMobileMobileMenu && (
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
                <Route path="admin" element={<Admin />} />
                <Route path="photography" element={<PhotographyPage />} />
              </Routes>
            </Suspense>
          </RouteErrorBoundary>
        )}
      </div>
    </div>
  );
}

export default App;
