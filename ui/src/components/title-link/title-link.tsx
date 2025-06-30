import "./title-link.css";

export function TitleLink({
  children,
  href,
  onClick,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <div className="title-link" onClick={onClick}>
        {children}
      </div>
    );
  } else {
    return (
      <a className="title-link" href={href}>
        {children}
      </a>
    );
  }
}
