import "./admin-button.css";

/**
 * How much weight the button carries on the screen it sits on. Every screen
 * should have exactly one primary — the one obvious next action — so
 * anything standing beside it (Close, Select Image, Use default background)
 * asks for "secondary", and anything that destroys something asks for
 * "danger" (#457, design brief §2).
 */
export type AdminButtonVariant = "primary" | "secondary" | "danger";

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
