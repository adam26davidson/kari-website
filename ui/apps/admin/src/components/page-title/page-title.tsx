import { cn } from "../ui/cn";

/**
 * A migrated admin page's title: Newsreader italic with the low-opacity
 * maroon brush swash sweeping behind it — the one mark every board in
 * docs/design/admin-redesign wears at the top of the page.
 *
 * Level 2, because the shell's wordmark is the page's one `<h1>` (#504) and
 * the admin's sections open under it.
 *
 * Tailwind's preflight strips an `<h2>`'s size, weight and margin, so — as
 * with `wordmark.tsx` — every visible property is stated here rather than
 * taken from the browser. That includes the colour: the shared body default
 * is `--light-text`, which is right over the public site's background photo
 * and invisible on this paper, so a heading that inherits is a heading that
 * disappears (#457; test/design/text-contrast.test.ts pins that no admin
 * heading is left to inheritance).
 */
export function PageTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-foreground relative w-fit font-serif text-2xl leading-tight font-normal italic md:text-[32px]",
        className,
      )}
    >
      {/* Decorative only — the title's words are the heading, and a
          screen reader has no use for the brush stroke behind them.

          Drawn rather than imported: it is one path, it has to take the
          page's `--accent` (so a palette change carries), and an <img>
          could not. `preserveAspectRatio="none"` lets one stroke stretch
          to fit titles of any length, which a brush mark can absorb.

          Opacity 0.125 is measured, not guessed: the swash on Main.png is
          #EAE0DC over the #FAF7F2 paper, which is Maroon at 12.5%.

          At md and up it BLEEDS left of the text, into the 32px gutter the
          content column gains there (admin.css), so the stroke starts on
          paper before the first letter.

          At phone width it does the opposite and starts INSIDE the column.
          The phone gutter is only 8px, so the old -4px bleed put the
          stroke's taper 4px from the viewport edge: with no paper in front
          of it, the widest part of the lower lobe ran straight into the
          screen edge and the flourish read as a graphic sliding off the
          page rather than a brush mark. `left-2` puts the taper 16px in —
          twice the page gutter — which is the least inset at which the
          stroke visibly begins on paper. It starts under the title's first
          letter instead of before it, which a stroke sitting below the
          baseline carries fine.

          The minimum width is what makes it a brush stroke rather than a
          blot on the SHORT titles (#234): every section is one or two words
          ("Haiku", "Haiga"), and at `preserveAspectRatio="none"` a 320-unit
          sweep squeezed into 80px comes out as a pink wedge beside the word
          instead of sweeping past it. The boards draw the stroke running
          well clear of the title's last letter (`HaikuList.png`), which is
          the length these two numbers hold it to; a longer title (the home
          page's greeting) is already wider than both and keeps stretching
          the stroke as before. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 320 50"
        preserveAspectRatio="none"
        className="fill-accent pointer-events-none absolute -bottom-4 left-2 h-[1.55em] w-[calc(100%+0.75rem)] min-w-[190px] opacity-[0.125] md:-left-5 md:w-[calc(100%+1.75rem)] md:min-w-[240px]"
      >
        <path d="M0,32 C60,18 160,4 315,0 C200,9 110,26 44,50 Z" />
      </svg>
      {/* Positioned, so it paints over the positioned swash above it
          without either needing a z-index (and without this heading
          having to become a stacking context to contain one). */}
      <span className="relative">{children}</span>
    </h2>
  );
}
