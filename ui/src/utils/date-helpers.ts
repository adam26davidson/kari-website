/**
 * The one way a post's date is turned into text, so the date a list shows
 * and the date its search box matches against can never drift apart.
 * Day precision in the viewer's locale; the stored value is an ISO
 * timestamp pinned to UTC midnight, so it is read as a plain calendar
 * date (`timeZone: "UTC"`) rather than converted — otherwise viewers west
 * of UTC see the previous day.
 */
export function formatPostDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, { timeZone: "UTC" });
}
