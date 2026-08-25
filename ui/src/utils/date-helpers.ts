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

/**
 * Today, as a post date: UTC midnight of the author's local calendar day.
 * The write-time counterpart of formatPostDate — a bare
 * `new Date().toISOString()` stores the creation instant, which is already
 * tomorrow in UTC for an evening author west of UTC, so the list would
 * show the wrong day. (Broader write-time normalization across the
 * editors is #379.)
 */
export function todayAsPostDate(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  ).toISOString();
}

/**
 * The yyyy-mm-dd an `<input type="date">` needs, from a stored post date.
 * The read-back counterpart of todayAsPostDate: stored dates are UTC
 * midnight, so the ISO string's own date part is the calendar day to show
 * — no conversion. A malformed stored value yields "" rather than
 * throwing out of an Invalid Date's toISOString() (#154).
 */
export function toDateInputValue(value: string): string {
  const date = new Date(value);
  return isNaN(date.getTime()) ? "" : date.toISOString().split("T")[0];
}
