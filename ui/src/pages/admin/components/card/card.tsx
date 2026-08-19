import "./card.css";

export function Card(props: { children: React.ReactNode }) {
  return <div className="card">{props.children}</div>;
}
