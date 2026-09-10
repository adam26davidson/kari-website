import { ArrowUpRight } from "lucide-react";
import type { AdminPage } from "./admin-page";
import { RAIL_PILL, SectionLink } from "./section-link";
import { Wordmark } from "./wordmark";
import { useAdminAccount } from "../../auth/use-admin-account";
import { cn } from "../ui/cn";

/**
 * The tablet shell (768-1023px): the sidebar collapsed to a narrow rail,
 * per `*Tablet.png`.
 *
 * Every entry is NAMED, under its glyph — the boards draw the rail as bare
 * icons with the name in a `title`, but a tablet is a touch device and
 * never shows a tooltip, so on the real thing that is seven unidentifiable
 * pictures plus a bare arrow. See section-link.tsx for why the boards'
 * README permits the departure, for the type size those names are set in,
 * and for the pill width every entry here shares.
 *
 * The rail is 112px rather than the boards' 72px, and the 40px is spent on
 * the names: 104px of pill (the widest name on one line, in type no
 * smaller than anything else in the admin) plus a 4px gutter either side.
 * The tablet content column is 656px instead of 728px, 592px of it usable
 * inside `.admin-content`'s 32px padding, and the widest thing that column
 * has to hold is a 400px input — so nothing about the layout changes.
 *
 * There is no room for the wordmark, so it is rendered for screen readers
 * only — the page still needs its <h1> (#504) at every width, and the green
 * initial the boards show at the top of the rail is decoration standing in
 * for it. Sign out is the initial at the FOOT of the rail, which is where
 * the desktop sidebar keeps it too — labelled, so the two identical
 * circles are not the same puzzle twice.
 */
export function IconRail({ pages }: { pages: readonly AdminPage[] }) {
  const { name, initial, signOut } = useAdminAccount();

  return (
    <div className="flex w-28 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-5">
      <Wordmark className="sr-only" />
      <span
        aria-hidden="true"
        className="mb-6 flex size-9 items-center justify-center rounded-full bg-primary font-serif text-base text-primary-foreground italic"
      >
        {initial}
      </span>
      <nav aria-label="Your workshop" className="flex flex-col gap-1">
        {pages.map((page) => (
          <SectionLink key={page.id} page={page} compact />
        ))}
      </nav>
      <a
        href="/"
        className={cn(RAIL_PILL, "mt-auto text-accent hover:bg-sidebar-accent/60")}
      >
        <ArrowUpRight className="size-[18px] shrink-0" strokeWidth={1.75} />
        <span>See your site</span>
      </a>
      <button
        type="button"
        onClick={signOut}
        title={name ? `Sign out (${name})` : "Sign out"}
        className={cn(
          RAIL_PILL,
          "mt-2 cursor-pointer text-muted-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-full border border-sidebar-border bg-card font-serif text-base text-foreground italic"
        >
          {initial}
        </span>
        <span>Sign out</span>
      </button>
    </div>
  );
}
