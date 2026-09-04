import { useState } from "react";
import "@kari/shared/styles/app.css";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import { useSiteBackground } from "@kari/shared/hooks/use-site-background";
import { RouteErrorBoundary } from "@kari/shared/components/error-boundary/error-boundary";
import { Header } from "./components/header/header";
import { MobileMenu } from "./components/mobile-menu/mobile-menu";
import { Admin } from "./admin";

/**
 * The admin app's shell: the same `.whole-page` / `.content` frame and the
 * same site background as the public site, with the admin header bar. The
 * section itself (login, menu, routes) is `Admin`.
 *
 * Its pages are imported statically rather than lazily: this whole app is
 * already the chunk that only a maintainer downloads, so splitting inside
 * it would buy a logged-in user round trips, not savings.
 *
 * The tiptap editor stack is the deliberate exception (#419). It is about
 * half the app's weight, and only one page can show an editor, so it is
 * lazily loaded from admin-other-works-page.tsx: one round trip when a
 * post is opened, in exchange for every other admin page — including that
 * page's own list — no longer downloading it.
 */
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
            <Admin />
          </RouteErrorBoundary>
        )}
      </div>
    </div>
  );
}
