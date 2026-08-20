import { describe, it, expect } from "vitest";
import { formatPostDate } from "./date-helpers";

describe("formatPostDate", () => {
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
});
