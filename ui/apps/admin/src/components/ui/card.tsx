import { cn } from "./cn";

/**
 * shadcn/ui's Card, vendored (#233) by hand like `button.tsx` and
 * `textarea.tsx` — see the note in `button.tsx` for why not the CLI.
 *
 * Only the outer `Card` is here. shadcn ships CardHeader/Title/Description/
 * Content/Footer alongside it; the boards' admin cards are a plain white
 * panel whose contents each page lays out itself, so those are omitted until
 * a page needs one (the repo's vendoring convention: take the part you use).
 *
 * White on paper inside a warm hairline, radius 16px (`rounded-xl` — the
 * admin's `--radius-xl`, see styles/theme.css), and a warm shadow in
 * the `rgba(74,62,40,…)` family — all four straight out of
 * docs/design/admin-redesign/README.md's "Supporting values". Tailwind's
 * preflight leaves a `<div>` no chrome at all, so every one of them is
 * stated here rather than inherited.
 *
 * NOT the same thing as `components/card/card.tsx`, which is the fork of the
 * public site's translucent photo-over card that the not-yet-migrated admin
 * pages still render. That one goes when the last of them migrates (#240).
 */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground border-border rounded-xl border",
        "shadow-[0_1px_2px_rgba(74,62,40,0.06),0_8px_24px_rgba(74,62,40,0.06)]",
        className,
      )}
      {...props}
    />
  );
}
