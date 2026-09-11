import { cn } from "./cn";

/**
 * shadcn/ui's Textarea, vendored (#233) the same way `button.tsx` vendored
 * the Button in #592: by hand, because the shadcn CLI writes imports against
 * an `@/` alias this workspace's single `tsconfig.app.json` does not have.
 * Same recipe, same `data-slot`, minus the parts nothing here uses.
 *
 * The surface is the boards' field, not shadcn's default grey: `--popover`
 * (`#FFFEFB`) inside `--input` (`#DCD2BE`) is exactly the "field border
 * #DCD2BE on #FFFEFB" pair docs/design/admin-redesign/README.md lists under
 * "Supporting values", so a field reads as something to type in without
 * becoming a second panel edge.
 *
 * No focus-visible ring here, for the same reason `button-variants.ts` has
 * none: index.css declares one site-wide and UNLAYERED, so it already beats
 * any Tailwind utility (which is layered) this could say.
 *
 * `data-slot="textarea"` is also load-bearing beyond shadcn convention:
 * admin.css still styles bare `<textarea>` unlayered for the pages that have
 * not been migrated yet, and those rules opt out through
 * `:not([data-slot="textarea"])`. Without the attribute this renders as the
 * old grey 400px box.
 */
export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input bg-popover text-foreground placeholder:text-muted-foreground",
        // 100px is the height the admin's textareas have always had, and
        // what the boards draw; `resize-none` keeps today's behavior.
        "min-h-[100px] w-full resize-none rounded-lg border px-4 py-3",
        "font-sans text-sm leading-relaxed",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
