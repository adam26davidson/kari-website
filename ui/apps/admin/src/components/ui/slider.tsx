import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "./cn";

/**
 * shadcn/ui's Slider, vendored (#816) the same way `switch.tsx`,
 * `input.tsx`, `textarea.tsx` and `button.tsx` were: by hand, because the
 * shadcn CLI writes imports against an `@/` alias this workspace's single
 * `tsconfig.app.json` does not have. Same recipe, same `data-slot`, minus
 * the parts nothing here uses (vertical orientation, multiple thumbs).
 *
 * It exists for one control — the Appearance page's "See-through" — which
 * was a bare `<input type="range">` until this page migrated. A native
 * range renders in the browser's own blue with a grey track, which is the
 * one control on that screen not wearing the site's colours
 * (`docs/design/admin-redesign/Appearance.png` draws it Fir-filled with the
 * Sand remainder). `accent-color` cannot produce that two-tone track, and
 * doing it by hand means per-engine `::-webkit-slider-*` / `::-moz-range-*`
 * pseudo-element rules plus an inline-gradient hack for the WebKit fill —
 * more code than this, in a stylesheet this page no longer has.
 *
 * Radix is what keeps it a real slider: `role="slider"` with
 * `aria-valuenow`/`min`/`max`, arrow keys stepping and Home/End jumping.
 * Note the ROLE IS ON THE THUMB, not on the root — hence the two aria
 * props below being forwarded down to it, so `getByRole("slider", { name })`
 * and a visible `<label>`'s `id` both reach the thing that announces the
 * value. The props are radix's own: `value` and `onValueChange` deal in
 * ARRAYS even with one thumb, so a single-value caller passes `[n]` and
 * unwraps `([n]) => ...` on the way back.
 *
 * No focus-visible ring here, for the same reason `button-variants.ts` and
 * `switch.tsx` have none: index.css declares one site-wide and UNLAYERED,
 * so it already beats any Tailwind utility (which is layered) this could
 * say.
 */
export function Slider({
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none",
        "cursor-pointer data-[disabled]:cursor-not-allowed",
        "data-[disabled]:opacity-60",
        className,
      )}
      {...props}
    >
      {/* The remainder wears the field border's sand, the same pair the
          switch spends on a track and its fill, so an untouched slider
          reads as an empty control rather than as a second colour. */}
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-input relative h-1.5 w-full grow overflow-hidden rounded-full"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute h-full"
        />
      </SliderPrimitive.Track>
      {/* White inside a Fir ring: the boards' thumb reads as a handle on
          the filled part of the track rather than as a dot on top of it. */}
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          "border-primary block size-4 shrink-0 rounded-full border-2",
          "bg-white shadow-[0_1px_2px_rgba(74,62,40,0.25)]",
        )}
      />
    </SliderPrimitive.Root>
  );
}
