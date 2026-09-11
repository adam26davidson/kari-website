import { cn } from "./cn";

/**
 * shadcn/ui's Input, vendored (#234) the same way `textarea.tsx` vendored
 * the Textarea in #233 and `button.tsx` the Button in #592: by hand,
 * because the shadcn CLI writes imports against an `@/` alias this
 * workspace's single `tsconfig.app.json` does not have. Same recipe, same
 * `data-slot`, minus the parts nothing here uses.
 *
 * The surface is the boards' field, not shadcn's default grey, and it is
 * deliberately the same pair its sibling Textarea spends: `--popover`
 * (`#FFFEFB`) inside `--input` (`#DCD2BE`), the "field border #DCD2BE on
 * #FFFEFB" docs/design/admin-redesign/README.md lists under "Supporting
 * values". A publisher box and a haiku box sitting one above the other on
 * the same card have to read as the same kind of thing.
 *
 * No focus-visible ring here, for the same reason `button-variants.ts` has
 * none: index.css declares one site-wide and UNLAYERED, so it already beats
 * any Tailwind utility (which is layered) this could say.
 *
 * `data-slot="input"` is also load-bearing beyond shadcn convention:
 * admin.css still styles bare `<input>` unlayered for the pages that have
 * not been migrated yet, and those rules opt out through
 * `:not([data-slot="input"])`. Without the attribute this renders as the
 * old grey 400px box.
 */
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "border-input bg-popover text-foreground placeholder:text-muted-foreground",
        // 40px, the height of the Button beside it — a search field and an
        // "Add a haiku" standing on one row of the boards' list card are
        // drawn as one pair, not two heights.
        "h-10 w-full rounded-lg border px-4",
        "font-sans text-sm",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
