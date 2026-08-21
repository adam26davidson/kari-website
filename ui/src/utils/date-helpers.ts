/**
 * The one way a post's date is turned into text, so the date a list shows
 * and the date its search box matches against can never drift apart.
 * Day precision in the viewer's locale; the stored value is an ISO
 * timestamp.
 */
export function formatPostDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString();
}
