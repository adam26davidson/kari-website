import { ArrowUpRight } from "lucide-react";
import type { AdminPage } from "./admin-page";
import { SectionLink } from "./section-link";
import { Wordmark } from "./wordmark";
import { useAdminAccount } from "../../auth/use-admin-account";

/**
 * The desktop shell's 280px cream sidebar (docs/design/admin-redesign,
 * `Main.png`): the wordmark, the sections, and — pinned to the bottom — the
 * way out to the public site and who is signed in.
 *
 * "See your site" is a plain anchor, not a router link: it leaves this
 * application for the public build. It is maroon because everything
 * pointing out of the workshop is (README, "Green leads; maroon supports").
 */
export function Sidebar({ pages }: { pages: readonly AdminPage[] }) {
  const { name, initial, signOut } = useAdminAccount();

  return (
    <div className="flex w-70 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6">
      <Wordmark className="px-3" />
      <p className="mt-1 mb-5 px-3 font-sans text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Your workshop
      </p>
      <nav aria-label="Your workshop" className="flex flex-col gap-0.5">
        {pages.map((page) => (
          <SectionLink key={page.id} page={page} />
        ))}
      </nav>
      {/* `mt-auto` rather than a fixed height above it: the section list
          grows by one on the staging builds, and the block below should
          simply keep the bottom of the column either way. */}
      <div className="mt-auto flex flex-col gap-4 border-t border-sidebar-border pt-4">
        <a
          href="/"
          className="flex items-center gap-2 px-3 font-sans text-sm font-medium text-accent hover:underline"
        >
          <ArrowUpRight className="size-4 shrink-0" strokeWidth={1.75} />
          See your site
        </a>
        <div className="flex min-w-0 items-center gap-3 px-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-serif text-base text-primary-foreground italic"
          >
            {initial}
          </span>
          <div className="flex min-w-0 flex-col">
            {/* One line, ellipsized. An account with no display name set
                shows its EMAIL here, which is one unbreakable word and
                would otherwise widen the whole column (#573). */}
            <span className="truncate font-sans text-sm text-foreground">
              {name}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="w-fit cursor-pointer font-sans text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
