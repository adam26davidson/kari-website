import { ArrowUpRight } from "lucide-react";
import { MOBILE_MENU_ID, PAGES } from "@kari/shared/constants";
import type { AdminPage } from "./admin-page";
import { SectionLink } from "./section-link";
import { useAdminAccount } from "../../auth/use-admin-account";

/**
 * The phone-width menu behind the top bar's hamburger (`MobileMenu.png`).
 *
 * It merges the two navigations a phone otherwise has no room for: the
 * workshop's own sections, which the sidebar shows at every wider width,
 * and the public site's pages, which are the only way out of the admin on a
 * phone. Before #592 it listed the public pages ALONE, so on a phone the
 * admin sections were reachable only from a grid wedged above the content.
 *
 * The public pages are plain anchors set in the display face: every one of
 * them leaves this application for the public build, and the change of
 * typeface plus the maroon and the out-arrow say so three times over.
 */
export function AdminMobileMenu({
  pages,
  onNavigate,
}: {
  pages: readonly AdminPage[];
  onNavigate: () => void;
}) {
  const { signOut } = useAdminAccount();

  return (
    // The id is what the top bar's hamburger names in aria-controls (#502).
    <div
      id={MOBILE_MENU_ID}
      className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-background px-4 pt-4 pb-6"
    >
      <p className="mb-2 px-3 font-sans text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Your workshop
      </p>
      <nav aria-label="Your workshop" className="flex flex-col gap-0.5">
        {pages.map((page) => (
          <SectionLink key={page.id} page={page} onNavigate={onNavigate} />
        ))}
      </nav>
      <p className="mt-6 mb-2 border-t border-border px-3 pt-6 font-sans text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Your site
      </p>
      <nav aria-label="Your site" className="flex flex-col">
        {PAGES.map((page) => (
          <a
            key={page.path}
            href={page.path}
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 font-serif text-base text-accent italic"
          >
            {page.name}
            <ArrowUpRight className="size-4 shrink-0" strokeWidth={1.75} />
          </a>
        ))}
      </nav>
      <button
        type="button"
        onClick={signOut}
        className="mt-8 w-full cursor-pointer py-3 text-center font-sans text-sm text-muted-foreground"
      >
        Sign out
      </button>
    </div>
  );
}
