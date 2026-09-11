import { cva } from "class-variance-authority";

/**
 * The button's looks, as a `cva` recipe (shadcn/ui's shape, this site's
 * palette — docs/design/admin-redesign/README.md).
 *
 * It lives beside `button.tsx` rather than inside it because
 * `react-refresh/only-export-components` — which `npm run lint` runs at
 * `--max-warnings 0` — wants a module that exports a component to export
 * nothing else. `alert-dialog.tsx` and `admin-button.tsx` both need the
 * recipe without needing the component, so it is its own module.
 *
 * Four variants and no more, because the design brief allows exactly four
 * weights of action (§2, #457): one filled green primary per screen, the
 * quiet chip that stands beside it, the outlined destructive that has to
 * read as destructive without out-shouting the primary, and the filled
 * destructive for the one screen where destroying IS the point.
 */
export const buttonVariants = cva(
  // No focus-visible ring here: index.css declares one site-wide, unlayered,
  // so it already beats anything a Tailwind utility (which is layered) could
  // say — and it is the ring test/design/text-contrast.test.ts vouches for.
  "inline-flex w-fit shrink-0 cursor-pointer items-center justify-center " +
    "gap-2 whitespace-nowrap rounded-lg font-sans text-sm font-medium " +
    "transition-colors disabled:pointer-events-none disabled:cursor-not-allowed " +
    "disabled:border-transparent disabled:bg-muted disabled:text-muted-foreground " +
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover " +
          "active:bg-primary-hover",
        // The chip: a warm card fill inside a Sand hairline. Opaque, like
        // everything else on this palette — a translucent control drifts
        // with whatever is behind it (#278, #321).
        secondary:
          "border border-border bg-card text-foreground hover:bg-muted " +
          "active:bg-muted",
        danger:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 " +
          "active:bg-destructive/90",
        // Spends no fill at all — maroon word, maroon ring, the row showing
        // through — so Delete stays the lightest mark in a list row rather
        // than competing with the page's one primary action (#599, #550).
        dangerSecondary:
          "border border-destructive bg-transparent text-destructive " +
          "hover:bg-destructive/10 active:bg-destructive/10",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 px-3 text-sm",
        // The move arrows, and only them: since #457 every icon-only
        // control left in the admin is a low-consequence directional
        // nudge, and the boards draw those as circles. Square, so the
        // `rounded-full` is a circle rather than a pill, and 44px below
        // `sm` — the size a touch target stops being a gamble at, which
        // the legacy `.admin-icon-button` phone rule says in its own way
        // and which stays behind with that fork (#240).
        icon: "size-10 rounded-full max-sm:size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);
