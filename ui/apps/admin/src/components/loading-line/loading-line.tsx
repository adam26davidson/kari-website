/**
 * What an admin page shows while its code is still on its way: one quiet
 * Stone line where the page's content will appear (#949). Used by every
 * admin Suspense fallback and by the whats-on-test page's own load.
 *
 * Deliberately not the shared `.loading` class: that rule in
 * packages/shared/src/styles/index.css is the public site's notice card —
 * a pale panel with a black drop shadow, 80px down the paper — and, being
 * unlayered, it outranks every Tailwind utility on the same element.
 */
export function LoadingLine() {
  return (
    <p role="status" className="text-muted-foreground font-sans text-sm">
      Loading...
    </p>
  );
}
