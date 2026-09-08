import { ArrowUpRight } from "lucide-react";
import type { AdminPage } from "./admin-page";
import { SectionLink } from "./section-link";
import { Wordmark } from "./wordmark";
import { useAdminAccount } from "../../auth/use-admin-account";

/**
 * The tablet shell (768-1023px): the sidebar collapsed to a 72px rail of
 * icons, per `*Tablet.png`.
 *
 * There is no room for the wordmark, so it is rendered for screen readers
 * only — the page still needs its <h1> (#504) at every width, and the green
 * initial the boards show at the top of the rail is decoration standing in
 * for it. Sign out is the initial at the FOOT of the rail, which is where
 * the desktop sidebar keeps it too.
 */
export function IconRail({ pages }: { pages: readonly AdminPage[] }) {
  const { name, initial, signOut } = useAdminAccount();

  return (
    <div className="flex w-18 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-5">
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
        title="See your site"
        className="mt-auto flex size-11 items-center justify-center rounded-lg text-accent hover:bg-sidebar-accent/60"
      >
        <ArrowUpRight className="size-[18px]" strokeWidth={1.75} />
        <span className="sr-only">See your site</span>
      </a>
      <button
        type="button"
        onClick={signOut}
        title={name ? `Sign out (${name})` : "Sign out"}
        className="mt-2 flex size-9 cursor-pointer items-center justify-center rounded-full border border-sidebar-border bg-card font-serif text-base text-foreground italic hover:bg-sidebar-accent/60"
      >
        <span aria-hidden="true">{initial}</span>
        <span className="sr-only">Sign out</span>
      </button>
    </div>
  );
}
