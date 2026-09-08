import { buttonVariants } from "../ui/button-variants";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";

/**
 * How much weight the button carries on the screen it sits on. Every screen
 * should have exactly one primary — the one obvious next action — so
 * anything standing beside it (Close, Select an image, Use default background)
 * asks for "secondary", and anything that destroys something asks for
 * "danger" (#457, design brief §2).
 *
 * "danger-secondary" is for a destructive action that is not what the
 * screen is FOR: the photography editor's per-image remove, whose screen's
 * primary is Save. Filled, a button that wide out-shouts Save from the
 * bottom of a sub-panel; outlined, the red still says "this destroys
 * something" while the weight stays secondary. Filled "danger" is for the
 * case where destroying IS the point (the image-cleanup sweep).
 */
export type AdminButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "danger-secondary";

/** This component's four weights, as the shadcn recipe's names for them. */
const RECIPE_VARIANT = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
  "danger-secondary": "dangerSecondary",
} as const;

/**
 * The classes this button wore before #592. They are no longer what styles
 * it — the recipe above is — but they are still load-bearing twice over:
 * `admin-item-list.css` reaches a row's buttons through
 * `.admin-data-list-item-controls .admin-button` (and its Delete through
 * `.danger-secondary`), and the e2e journeys click Save, Log In and the
 * confirmation's Yes/No by `.admin-button`. They go with those two, in the
 * per-page migrations and #240.
 */
const LEGACY_CLASS = {
  primary: "admin-button",
  secondary: "admin-button secondary",
  danger: "admin-button danger",
  "danger-secondary": "admin-button danger-secondary",
} as const;

/**
 * The admin's button: an adapter over the vendored shadcn `Button` (#592)
 * that keeps this component's own small API — four named weights, an
 * optional `htmlFor` that turns it into a label — so its ~40 call sites did
 * not have to change with the styling.
 */
export function AdminButton({
  children,
  onClick,
  htmlFor,
  variant = "primary",
  /**
   * Button branch only: the `htmlFor` branch renders a <label>, which has
   * no disabled state, and nothing in the admin needs a disabled picker.
   */
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  htmlFor?: string;
  variant?: AdminButtonVariant;
  disabled?: boolean;
}) {
  const className = LEGACY_CLASS[variant];
  if (htmlFor === undefined) {
    return (
      <Button
        variant={RECIPE_VARIANT[variant]}
        onClick={onClick}
        disabled={disabled}
        className={className}
      >
        {children}
      </Button>
    );
  }
  // A label wired to a form control (e.g. the photo picker's hidden file
  // input) — clicking it must keep triggering that control, so it stays a
  // label but is exposed and operable as a button: focusable, activated by
  // Enter/Space, and announced by its content.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLLabelElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  };
  return (
    <label
      htmlFor={htmlFor}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      className={cn(
        buttonVariants({ variant: RECIPE_VARIANT[variant] }),
        className,
      )}
    >
      {children}
    </label>
  );
}
