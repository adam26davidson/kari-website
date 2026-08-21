import { describe, it, expect, afterEach } from "vitest";
import { formatPostDate } from "./date-helpers";

describe("formatPostDate", () => {
  const hostTimeZone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = hostTimeZone;
  });

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
    process.env.TZ = "America/Los_Angeles";
    // The same calendar day rendered from a local-midnight Date: locale
    // agnostic, so this says nothing about the format, only the day.
    expect(formatPostDate("2026-01-01T00:00:00.000Z")).toBe(
      new Date(2026, 0, 1).toLocaleDateString(),
    );
  });

  it("shows the stored calendar day east of UTC", () => {
    process.env.TZ = "Pacific/Kiritimati";
    expect(formatPostDate("2026-01-01T00:00:00.000Z")).toBe(
      new Date(2026, 0, 1).toLocaleDateString(),
    );
  });
});
