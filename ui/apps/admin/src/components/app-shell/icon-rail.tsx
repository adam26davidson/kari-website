import { ArrowUpRight } from "lucide-react";
import type { AdminPage } from "./admin-page";
import { SectionLink } from "./section-link";
import { Wordmark } from "./wordmark";
import { useAdminAccount } from "../../auth/use-admin-account";

/**
 * The tablet shell (768-1023px): the sidebar collapsed to a narrow rail,
 * per `*Tablet.png`.
 *
 * Every entry is NAMED, in small type under its glyph — the boards draw the
 * rail as bare icons with the name in a `title`, but a tablet is a touch
 * device and never shows a tooltip, so on the real thing that is seven
 * unidentifiable pictures plus a bare arrow. See section-link.tsx for why
 * the boards' README permits the departure. The rail is 88px rather than
 * 72px to hold the labels; the content column loses 16px and nothing else
 * about the layout changes.
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
    <div className="flex w-22 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-5">
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
        className="mt-auto flex w-20 flex-col items-center gap-1.5 rounded-lg px-2 py-2 text-center font-sans text-[10px] leading-[1.2] text-accent hover:bg-sidebar-accent/60"
      >
        <ArrowUpRight className="size-[18px] shrink-0" strokeWidth={1.75} />
        <span>See your site</span>
      </a>
      <button
        type="button"
        onClick={signOut}
        title={name ? `Sign out (${name})` : "Sign out"}
        className="mt-2 flex w-20 cursor-pointer flex-col items-center gap-1.5 rounded-lg px-2 py-2 text-center font-sans text-[10px] leading-[1.2] text-muted-foreground hover:bg-sidebar-accent/60"
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
