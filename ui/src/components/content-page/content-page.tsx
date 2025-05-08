import "./content-page.css";

export function ContentPage({
  children,
  isLoading,
}: {
  children?: React.ReactNode;
  isLoading: boolean;
}) {
  return (
    <div className="content-page">
      {isLoading && <div className="loading">Loading...</div>}
      {children}
    </div>
  );
}
