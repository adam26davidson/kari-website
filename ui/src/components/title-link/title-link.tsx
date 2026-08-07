import { Link } from "react-router-dom";
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
  } else if (href && href.startsWith("/")) {
    return (
      <Link className="title-link" to={href}>
        {children}
      </Link>
    );
  } else {
    return (
      <a className="title-link" href={href}>
        {children}
      </a>
    );
  }
}
