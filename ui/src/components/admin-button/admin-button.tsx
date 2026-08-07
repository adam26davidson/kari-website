import "./admin-button.css";

export function AdminButton({
  children,
  onClick,
  htmlFor,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  htmlFor?: string;
}) {
  if (htmlFor === undefined) {
    return (
      <button type="button" onClick={onClick} className="admin-button">
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
      className="admin-button"
    >
      {children}
    </label>
  );
}
