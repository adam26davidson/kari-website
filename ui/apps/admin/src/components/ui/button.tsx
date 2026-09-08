import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "./button-variants";
import { cn } from "./cn";

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

/**
 * shadcn/ui's Button, vendored (#592).
 *
 * Vendored by hand rather than through the shadcn CLI: the CLI writes
 * imports against an `@/` alias, and this workspace's single
 * `tsconfig.app.json` spans three packages with no such alias. The output
 * is otherwise the component the CLI would have written — same recipe, same
 * `data-slot`, minus the `asChild` slot nothing here uses.
 *
 * `type="button"` by default because every button in the admin is an
 * action, not a form submit; a caller that wants a submit says so.
 */
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      type="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
