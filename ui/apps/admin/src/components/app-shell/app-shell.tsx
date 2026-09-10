import { useState } from "react";
import { useIsMobile } from "@kari/shared/hooks/use-is-mobile";
import type { AdminPage } from "./admin-page";
import { AdminMobileMenu } from "./admin-mobile-menu";
import { IconRail } from "./icon-rail";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/** Below this the shell is a top bar and a full-screen menu. */
const PHONE_WIDTH = 768;
/** Below this the sidebar is a 112px icon rail; at or above it, 280px. */
const SIDEBAR_WIDTH = 1024;

/**
 * The admin's frame: one navigation, chosen by viewport width, plus the
 * scrolling content column beside (or under) it.
 *
 * Which nav renders is decided in JS rather than by three CSS-hidden
 * copies, and that is deliberate: the three navs list the same sections, so
 * three copies would put three `.admin-menu-item`s per section in the
 * document, and every Playwright locator that reaches a section by that
 * class would fail strict mode. One nav in the DOM is also one nav in the
 * accessibility tree and one tab order.
 *
 * `.admin-content` is the app's single scroll container
 * (test/design/scroll-containers.test.ts). Everything inside it grows; only
 * this box turns a tall page into a scrollbar.
 */
export function AppShell({
  pages,
  children,
}: {
  pages: readonly AdminPage[];
  children: React.ReactNode;
}) {
  const isPhone = useIsMobile(PHONE_WIDTH);
  const isNarrow = useIsMobile(SIDEBAR_WIDTH);
  const [menuOpen, setMenuOpen] = useState(false);

  if (isPhone) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <TopBar
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen(!menuOpen)}
        />
        {menuOpen ? (
          <AdminMobileMenu pages={pages} onNavigate={() => setMenuOpen(false)} />
        ) : (
          <main className="admin-content">{children}</main>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-row bg-background">
      {isNarrow ? <IconRail pages={pages} /> : <Sidebar pages={pages} />}
      <main className="admin-content">{children}</main>
    </div>
  );
}
