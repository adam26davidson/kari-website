import "./admin-button.css";

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
  "primary" | "secondary" | "danger" | "danger-secondary";

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
  const className =
    variant === "primary" ? "admin-button" : `admin-button ${variant}`;
  if (htmlFor === undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={className}
      >
        {children}
      </button>
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
      className={className}
    >
      {children}
    </label>
  );
}
