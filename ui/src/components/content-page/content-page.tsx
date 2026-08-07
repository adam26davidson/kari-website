import "./content-page.css";

export function ContentPage({
  children,
  isLoading = false,
}: {
  children?: React.ReactNode;
  isLoading?: boolean;
}) {
  // Spinner and children are mutually exclusive: while loading, pages
  // would otherwise show an empty list/grid beneath "Loading...".
  return (
    <div className="content-page">
      {isLoading ? <div className="loading">Loading...</div> : children}
    </div>
  );
}
