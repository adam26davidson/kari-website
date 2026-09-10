import { cn } from "../ui/cn";

/**
 * The admin's title, and the page's one <h1> (#504) — the admin pages open
 * at level 2, so without this the outline would start there under nothing.
 *
 * Rendered by exactly one part of the shell at any width: the sidebar at
 * desktop, the top bar on a phone, and — because the tablet rail is 72px of
 * icons with no room for a name — a screen-reader-only copy in the rail.
 * The rendered text is "Kari Davidson", which is what the boards show and
 * what the sidebar's "YOUR WORKSHOP" label sits under; the accessible name
 * carries the " - Admin" that says which of the two apps this is.
 *
 * That extra is stated with aria-label rather than an sr-only span, because
 * the accessible-name algorithm trims each child's text before joining it
 * and inserts no separator between inline children -- so a
 * `<span class="sr-only"> - Admin</span>` sibling names the heading
 * "Kari Davidson- Admin", with the space eaten. Browsers are more forgiving
 * than the spec here, which is how it went unnoticed until jsdom 30 started
 * reporting a <span>'s computed display as "inline".
 *
 * Tailwind's preflight strips the browser's <h1> size, weight and margin,
 * so unlike the public site's title (see heading-chrome.test.ts) this one
 * has no UA chrome to neutralize — every value below is stated.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <h1
      aria-label="Kari Davidson - Admin"
      className={cn(
        "font-serif text-[22px] leading-none font-normal text-foreground italic",
        className,
      )}
    >
      Kari Davidson
    </h1>
  );
}
