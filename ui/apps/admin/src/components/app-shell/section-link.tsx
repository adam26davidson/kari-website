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
/**
 * The shape of one entry in the tablet rail: a stacked icon-over-label pill.
 * Declared once and worn by all three kinds of entry — the section links
 * here, and "See your site" and the sign-out in icon-rail.tsx — because a
 * rail whose pills are not all the same width is a ragged left column, and
 * the width has now been tuned twice; two of the three places are easy to
 * change and forget.
 *
 * An 88px pill with 8px of side padding leaves a 72px line box. Measured in
 * Geist at 10px against the built stylesheet, that fits every label the rail
 * carries on ONE line: the longest, "Image cleanup" (71px), with 8.5px of
 * pill either side of it, and the shortest sections with far more. Two
 * earlier tries missed in opposite directions — an 80px pill with 4px
 * padding put "Image cleanup" 4.5px from the edges (edge-to-edge), and 8px
 * padding on the same pill wrapped it and "What's on test" onto two lines,
 * making those entries 12px taller than the single-word ones above them.
 * Uniform single lines cost 8px of the tablet content column, which at
 * 768px is a little over one percent of it.
 *
 * Padding rather than a `max-width`, so a fallback face that renders a label
 * wider than 72px spills into the padding rather than out of the pill.
 * Colour and hover are the caller's: the shape is all that is shared.
 */
export const RAIL_PILL =
  "flex w-22 flex-col items-center gap-1.5 rounded-lg px-2 py-2 " +
  "text-center font-sans text-[10px] leading-[1.2]";

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
            ? cn(RAIL_PILL, "justify-center")
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
