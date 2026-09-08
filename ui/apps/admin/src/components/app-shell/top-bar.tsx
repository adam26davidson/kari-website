import { Menu, X } from "lucide-react";
import { MOBILE_MENU_ID } from "@kari/shared/constants";
import { Wordmark } from "./wordmark";

/**
 * The phone shell's 56px bar (`Mobile.png`): the wordmark, and the one
 * control a phone header has room for.
 *
 * The button keeps its "Menu" name in both states so it is the same control
 * throughout — `aria-expanded` is what says whether the menu is open, and
 * the glyph says the same thing to everyone else. `aria-controls` is only
 * set while the menu is mounted, because the attribute may only name an
 * element that is actually in the document (#502).
 */
export function TopBar({
  menuOpen,
  onToggleMenu,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  return (
    <div className="flex h-14 w-full shrink-0 items-center justify-between border-b border-border bg-sidebar px-4">
      <Wordmark />
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? MOBILE_MENU_ID : undefined}
        onClick={onToggleMenu}
        // 44px of target for a fingertip, with the glyph optically back on
        // the bar's own gutter via the negative margin — the same trade the
        // public bar's hamburger makes (#545).
        className="-mr-2.5 flex size-11 cursor-pointer items-center justify-center rounded-lg text-foreground"
      >
        {menuOpen ? (
          <X className="size-5" strokeWidth={1.75} />
        ) : (
          <Menu className="size-5" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}
