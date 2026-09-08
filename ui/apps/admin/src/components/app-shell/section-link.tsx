import { NavLink } from "react-router";
import type { AdminPage } from "./admin-page";
import { cn } from "../ui/cn";

/**
 * One section in the admin's nav, in either of the two shapes the shell
 * asks for: the full row (sidebar and phone menu) or the narrow stacked
 * icon-over-label the tablet rail leaves room for.
 *
 * The label is real, VISIBLE text in both shapes. `*Tablet.png` draws the
 * rail as bare glyphs with the name in a `title` tooltip, and that is the
 * one place this shell departs from the boards: tablet width is a touch
 * device, where there is no hover and so no tooltip, leaving seven unnamed
 * icons for the one non-technical person this admin exists for. The boards'
 * README allows exactly this — follow the boards "unless the design brief's
 * behavioral principles say otherwise" — and the rail is still a rail: a
 * narrow left column that keeps the content the full sidebar would eat.
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
  /** The stacked, narrow rail shape (tablet). */
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = page.icon;
  return (
    <NavLink
      to={`/${page.id}`}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "admin-menu-item flex rounded-lg font-sans transition-colors",
          compact
            ? // 80px of column for an 11-character word ("Photography") set
              // at 10px, so the longest single-word label still fits on one
              // line; the two-word ones wrap to two and the pill grows with
              // them rather than clipping.
              "w-20 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[10px] leading-[1.2]"
            : "min-h-11 items-center justify-start gap-3 px-3 py-2 text-[15px]",
          isActive
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-foreground hover:bg-sidebar-accent/60",
        )
      }
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
      <span>{page.label}</span>
    </NavLink>
  );
}
