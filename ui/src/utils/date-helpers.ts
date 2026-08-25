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
 * The leading calendar day of an ISO-8601 string. That day is the one the
 * string names in its OWN offset ("2026-01-01T17:00-08:00" says Jan 1),
 * which is the day the author picked, so it is read textually rather than
 * through a Date — parsing would convert it to the UTC instant, Jan 2.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** An instant's calendar day where it is running, pinned to UTC midnight. */
function pinLocalDayToUtcMidnight(instant: Date): string {
  return new Date(
    Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()),
  ).toISOString();
}

/**
 * The one way a post date is written: the calendar day `dateInput` names,
 * as `YYYY-MM-DDT00:00:00.000Z`. Every admin editor that sets a date goes
 * through here, so formatPostDate's read-side assumption — that a stored
 * date is UTC midnight and can be shown as a plain calendar day — is
 * enforced rather than merely true by habit (#379). A non-midnight or
 * local-offset timestamp would otherwise render its UTC day, which can be
 * the day after the one the author picked.
 *
 * Returns null for anything unparseable (an empty date input, a corrupted
 * stored value) so callers can keep the post's last valid date instead of
 * crashing on Invalid Date (#154).
 */
export function toPostDate(dateInput: string | Date): string | null {
  if (typeof dateInput === "string") {
    const day = ISO_DAY.exec(dateInput)?.[0];
    if (day !== undefined) {
      const pinned = `${day}T00:00:00.000Z`;
      const parsed = new Date(pinned);
      // A well-shaped but impossible day is rejected rather than silently
      // moved: V8 rejects an out-of-range month outright, but rolls an
      // out-of-range day over (2026-02-30 parses as March 2nd), so the
      // round trip has to be checked as well as the parse.
      if (isNaN(parsed.getTime())) return null;
      return parsed.toISOString() === pinned ? pinned : null;
    }
  }
  // A Date, or a string in some other format: an instant, whose day is
  // the one it falls on locally (17:00 on Jan 1 in PST means Jan 1).
  const instant =
    typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return isNaN(instant.getTime()) ? null : pinLocalDayToUtcMidnight(instant);
}

/**
 * Today, as a post date: UTC midnight of the author's local calendar day.
 * The write-time counterpart of formatPostDate — a bare
 * `new Date().toISOString()` stores the creation instant, which is already
 * tomorrow in UTC for an evening author west of UTC, so the list would
 * show the wrong day.
 */
export function todayAsPostDate(): string {
  return pinLocalDayToUtcMidnight(new Date());
}
