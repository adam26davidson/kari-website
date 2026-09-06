import "@kari/shared/styles/mobile-menu.css";
import { MOBILE_MENU_ID, PAGES } from "@kari/shared/constants";

/**
 * The phone-width nav behind the admin bar's hamburger. It lists the public
 * site's pages, exactly as it did while the admin lived inside that app —
 * the only way out of the admin section on a phone.
 *
 * Plain anchors rather than router links: every one of these leaves this
 * application for the public build.
 */
export function MobileMenu({
  setShowingMobileMenu,
}: {
  setShowingMobileMenu: (showing: boolean) => void;
}) {
  return (
    // The id is what the admin bar's hamburger names in aria-controls (#502).
    <div id={MOBILE_MENU_ID} className="mobile-menu">
      {PAGES.map((page) => (
        <a
          key={page.path}
          href={page.path}
          className="mobile-menu-item"
          onClick={() => setShowingMobileMenu(false)}
        >
          {page.name}
        </a>
      ))}
    </div>
  );
}
