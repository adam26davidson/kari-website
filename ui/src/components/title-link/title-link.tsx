import { Link } from "react-router";
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
      <button type="button" className="title-link" onClick={onClick}>
        {children}
      </button>
    );
  } else if (href && href.startsWith("/")) {
    return (
      <Link className="title-link" to={href}>
        {children}
      </Link>
    );
  } else {
    return (
      <a
        className="title-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }
}
