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
  return (
    <label htmlFor={htmlFor} onClick={onClick} className="admin-button">
      {children}
    </label>
  );
}
