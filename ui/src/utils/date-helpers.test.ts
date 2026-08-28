import { describe, it, expect, afterEach, vi } from "vitest";
import {
  applyTimeZone,
  restoreHostTimeZoneAfterEach,
} from "../test/timezone";
import {
  formatPostDate,
  toDateInputValue,
  toPostDate,
  todayAsPostDate,
} from "./date-helpers";

describe("formatPostDate", () => {
  restoreHostTimeZoneAfterEach();

  it("renders the year, month and day of an ISO timestamp", () => {
    // Midday UTC so the calendar day is the same either side of the
    // date line, whatever timezone the test host runs in.
    const formatted = formatPostDate("2026-03-05T12:00:00.000Z");
    expect(formatted).toMatch(/\b2026\b/);
    expect(formatted).toMatch(/\b0?3\b/);
    expect(formatted).toMatch(/\b0?5\b/);
  });

  it("drops the time of day", () => {
    const morning = formatPostDate("2026-03-05T01:00:00.000Z");
    const evening = formatPostDate("2026-03-05T12:00:00.000Z");
    expect(evening).toBe(morning);
    expect(evening).not.toMatch(/:/);
  });

  it("distinguishes different days", () => {
    expect(formatPostDate("2026-03-05T12:00:00.000Z")).not.toBe(
      formatPostDate("2026-03-06T12:00:00.000Z"),
    );
  });

  it("shows the stored calendar day west of UTC", () => {
    // Stored post dates are pinned to UTC midnight, so a viewer behind
    // UTC saw the previous day. Run the assertion in a west-of-UTC zone
    // so it fails on a locale-converting formatter even though CI's host
    // clock is UTC.
    applyTimeZone("America/Los_Angeles");
    // The same calendar day rendered from a local-midnight Date: locale
    // agnostic, so this says nothing about the format, only the day.
    expect(formatPostDate("2026-01-01T00:00:00.000Z")).toBe(
      new Date(2026, 0, 1).toLocaleDateString(),
    );
  });

  it("shows the stored calendar day east of UTC", () => {
    applyTimeZone("Pacific/Kiritimati");
    expect(formatPostDate("2026-01-01T00:00:00.000Z")).toBe(
      new Date(2026, 0, 1).toLocaleDateString(),
    );
  });
});

describe("todayAsPostDate", () => {
  restoreHostTimeZoneAfterEach();
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pins the author's local calendar day to UTC midnight", () => {
    // 17:00 PST on Jan 1 is 01:00 UTC on Jan 2. The author means "Jan 1",
    // so the stored value must be Jan 1 at UTC midnight — not the creation
    // instant, which formatPostDate would then show as Jan 2.
    applyTimeZone("America/Los_Angeles");
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 17, 0, 0) });
    expect(todayAsPostDate()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("pins the local calendar day east of UTC too", () => {
    // 02:00 on Jan 2 in Kiritimati (UTC+14) is still Jan 1 in UTC.
    applyTimeZone("Pacific/Kiritimati");
    vi.useFakeTimers({ now: new Date(2026, 0, 2, 2, 0, 0) });
    expect(todayAsPostDate()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("round-trips through formatPostDate as today", () => {
    expect(formatPostDate(todayAsPostDate())).toBe(
      new Date().toLocaleDateString(),
    );
  });
});

describe("toPostDate", () => {
  restoreHostTimeZoneAfterEach();

  it("pins a date-input value to UTC midnight west of UTC", () => {
    // The editors' <input type="date"> hands over a bare calendar day.
    // Whatever zone the author sits in, the day they picked is the day
    // that must be stored — formatPostDate reads it back as UTC.
    applyTimeZone("America/Los_Angeles");
    expect(toPostDate("2026-01-01")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("pins a date-input value to UTC midnight east of UTC", () => {
    applyTimeZone("Pacific/Kiritimati");
    expect(toPostDate("2026-01-01")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("strips the time of day from an already-stored timestamp", () => {
    // The case the helper exists for: a timestamp that is not midnight
    // keeps the day its own offset names, rather than shifting.
    expect(toPostDate("2026-01-01T23:30:00.000Z")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("keeps the calendar day named by a local-offset timestamp", () => {
    // 17:00 on Jan 1 in PST is Jan 2 in UTC. The author wrote "Jan 1", so
    // that is the day to store — not the UTC day of the same instant.
    expect(toPostDate("2026-01-01T17:00:00.000-08:00")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("reads a Date as the calendar day in the author's own zone", () => {
    applyTimeZone("America/Los_Angeles");
    expect(toPostDate(new Date(2026, 0, 1, 17, 0, 0))).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("reads a non-ISO date string as its local calendar day", () => {
    applyTimeZone("America/Los_Angeles");
    expect(toPostDate("January 1, 2026")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns null for an empty value instead of throwing", () => {
    // Clearing a date input fires a change with "" (#154).
    expect(toPostDate("")).toBeNull();
  });

  it("returns null for a malformed string", () => {
    expect(toPostDate("not-a-date")).toBeNull();
  });

  it("returns null for an out-of-range calendar day", () => {
    // Rather than the March 2nd that a bare `new Date` would roll it to.
    expect(toPostDate("2026-02-30")).toBeNull();
  });

  it("returns null for an out-of-range month", () => {
    expect(toPostDate("2026-13-01")).toBeNull();
  });

  it("returns null for an Invalid Date", () => {
    expect(toPostDate(new Date(NaN))).toBeNull();
  });

  it("is idempotent", () => {
    const once = toPostDate("2026-01-01") as string;
    expect(toPostDate(once)).toBe(once);
  });

  it("agrees with todayAsPostDate on today", () => {
    expect(toPostDate(new Date())).toBe(todayAsPostDate());
  });
});

describe("toDateInputValue", () => {
  restoreHostTimeZoneAfterEach();

  it("renders a stored post date as its own calendar day", () => {
    expect(toDateInputValue("2026-01-01T00:00:00.000Z")).toBe("2026-01-01");
  });

  it("does not shift the day west of UTC", () => {
    // The input shows the day that formatPostDate shows, so a viewer's
    // zone must not move it — 2026-01-01 stays Jan 1 in Los Angeles.
    applyTimeZone("America/Los_Angeles");
    expect(toDateInputValue("2026-01-01T00:00:00.000Z")).toBe("2026-01-01");
  });

  it("does not shift the day east of UTC", () => {
    applyTimeZone("Pacific/Kiritimati");
    expect(toDateInputValue("2026-01-01T00:00:00.000Z")).toBe("2026-01-01");
  });

  it("drops the time of day from a timestamp that is not midnight", () => {
    expect(toDateInputValue("2026-03-05T12:00:00.000Z")).toBe("2026-03-05");
  });

  it("yields \"\" for a malformed stored date rather than throwing", () => {
    // An Invalid Date's toISOString() throws, which would take the whole
    // editor down on one corrupted record (#154).
    expect(toDateInputValue("not-a-date")).toBe("");
  });

  it("yields \"\" for a cleared input value", () => {
    expect(toDateInputValue("")).toBe("");
  });

  it("round-trips todayAsPostDate", () => {
    expect(toDateInputValue(todayAsPostDate())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
