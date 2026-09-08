import { RouteErrorBoundary } from "@kari/shared/components/error-boundary/error-boundary";
import { Admin } from "./admin";

/**
 * The admin app's outermost frame: the shared `.whole-page` box, which is
 * exactly as tall as the visible viewport (`100dvh`, with a `100vh`
 * fallback — #558) and is what makes the shell's one scroll container work.
 *
 * Everything else that used to be here went in #592. The header bar, the
 * public site's phone menu and the background photo were all inherited from
 * the public site, back when the admin lived inside that app; the admin now
 * has a shell of its own (sidebar / icon rail / phone menu) and its own
 * fixed look, so it neither reads the site's appearance settings nor
 * borrows its chrome. `Admin` owns the whole area below this.
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
  return (
    <div className="whole-page">
      <RouteErrorBoundary>
        <Admin />
      </RouteErrorBoundary>
    </div>
  );
}
