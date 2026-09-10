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
 * two of the three places are easy to change and forget.
 *
 * The label is `text-xs`, and the width follows from that rather than the
 * other way round. Three earlier rounds fitted these labels at 10px and
 * kept being told the rail was hard to read, which it was: 10px was the
 * SMALLEST type anywhere in the admin — under the sidebar's own 12px
 * "Sign out", under the 11px letterspaced "YOUR WORKSHOP" eyebrow (which
 * is uppercase and tracked, so it reads far larger than its number), and
 * far under the 15px sidebar sections these are the tablet copy of. The
 * one person this admin is for is not a developer and is reading it on a
 * touch screen, and the brief asks for readable type (principle 1), so the
 * app's primary navigation should not be its finest print. At `text-xs`
 * the rail ties the smallest size the admin already uses instead of
 * setting a new floor.
 *
 * Measured in Geist against the built stylesheet, 12px makes the longest
 * label the rail carries, "Image cleanup", 83px wide (it was 71px at
 * 10px). A 104px pill with 8px of side padding leaves an 88px line box, so
 * that label — and every shorter one — still sits on ONE line, with 10.5px
 * of pill either side of it rather than the 8.5px the 88px pill left. The
 * rail around it is 112px (icon-rail.tsx), which costs the tablet content
 * column 16px against the old 96px rail: at 768px that is 592px of usable
 * column instead of 608px, and the widest thing in it is a 400px input.
 *
 * Padding rather than a `max-width`, so a fallback face that renders a
 * label wider than 88px spills into the padding rather than out of the
 * pill. Colour and hover are the caller's: the shape is all that is shared.
 */
export const RAIL_PILL =
  "flex w-26 flex-col items-center gap-1.5 rounded-lg px-2 py-2 " +
  "text-center font-sans text-xs leading-[1.2]";

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
