import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "./cn";

/**
 * shadcn/ui's Switch, vendored (#237) the same way `input.tsx`,
 * `textarea.tsx` and `button.tsx` were: by hand, because the shadcn CLI
 * writes imports against an `@/` alias this workspace's single
 * `tsconfig.app.json` does not have. Same recipe, same `data-slot`, minus
 * the parts nothing here uses.
 *
 * It exists for one control — the other-works editor's "Published" — and
 * that is a deliberate change from the checkbox it replaces rather than a
 * restyle: `docs/design/admin-redesign/README.md` calls it out under its
 * notable decisions, and `WorksEditor.png` draws it green with the hint
 * beside it. A switch says "this is a state the site is in", which is what
 * publishing is; a checkbox says "this is a thing I am selecting".
 *
 * Radix is what makes it a real switch rather than a div that looks like
 * one: `role="switch"` with `aria-checked`, Space and Enter to flip it, and
 * a label's `htmlFor` reaching it through the hidden input it renders. It
 * is a `<button>`, NOT an `<input type="checkbox">` — tests reach it with
 * `getByRole("switch")`, and Playwright's `check()` / `toBeChecked()` do not
 * apply (click it, then assert `aria-checked`).
 *
 * No focus-visible ring here, for the same reason `button-variants.ts` has
 * none: index.css declares one site-wide and UNLAYERED, so it already beats
 * any Tailwind utility (which is layered) this could say.
 */
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // The track. Fir when on, the field border's sand when off — the
        // same pair the boards spend on a field's fill and its edge, so an
        // off switch reads as an empty control rather than as a second
        // colour (`WorksEditor.png`).
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center",
        "rounded-full p-0.5 transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-white",
          "transition-transform data-[state=checked]:translate-x-5",
          "data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
