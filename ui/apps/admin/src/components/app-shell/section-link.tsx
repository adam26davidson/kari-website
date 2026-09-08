import { NavLink } from "react-router";
import type { AdminPage } from "./admin-page";
import { cn } from "../ui/cn";

/**
 * One section in the admin's nav, in either of the two shapes the shell
 * asks for: the full row (sidebar and phone menu) or the icon-only square
 * the 72px tablet rail leaves room for.
 *
 * The label is real text in BOTH shapes — visually hidden in the rail
 * rather than replaced by an `aria-label` — so the accessible name, the
 * `title` tooltip and the e2e locator (`.admin-menu-item` filtered by text)
 * all read the same string at every width.
 *
 * `.admin-menu-item` is that e2e hook and nothing else now: the look is
 * Tailwind. It survives because `e2e/helpers.ts`, `auth.setup.ts` and two
 * specs locate sections by it, and because exactly one nav is mounted at a
 * time, so it can never match the same section twice (Playwright's strict
 * mode would fail if it did).
 *
 * NavLink is a real <a>, so a section is a browser-history entry, and it
 * sets `aria-current="page"` on the active one — which is what says "you
 * are here" to a screen reader, while the pill says it to everyone else.
 */
export function SectionLink({
  page,
  compact = false,
  onNavigate,
}: {
  page: AdminPage;
  /** The icon-only rail shape (tablet). */
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = page.icon;
  return (
    <NavLink
      to={`/${page.id}`}
      title={compact ? page.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "admin-menu-item flex items-center rounded-lg font-sans text-[15px]",
          "transition-colors",
          compact
            ? "size-11 justify-center"
            : "min-h-11 justify-start gap-3 px-3 py-2",
          isActive
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-foreground hover:bg-sidebar-accent/60",
        )
      }
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
      <span className={compact ? "sr-only" : undefined}>{page.label}</span>
    </NavLink>
  );
}
