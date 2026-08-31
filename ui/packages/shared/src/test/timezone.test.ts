import { describe, it, expect, afterEach } from "vitest";
import { applyTimeZone, restoreHostTimeZoneAfterEach } from "./timezone";

describe("applyTimeZone", () => {
  const hostTimeZone = process.env.TZ;
  afterEach(() => applyTimeZone(hostTimeZone));

  it("switches the process timezone", () => {
    applyTimeZone("America/Los_Angeles");
    // 17:00 on Jan 1 in PST is 01:00 UTC on Jan 2.
    expect(new Date(2026, 0, 1, 17).toISOString()).toBe(
      "2026-01-02T01:00:00.000Z",
    );
  });

  it("removes TZ rather than stringifying undefined", () => {
    applyTimeZone("America/Los_Angeles");

    applyTimeZone(undefined);

    // `process.env.TZ = undefined` would leave the literal string
    // "undefined", which ICU rejects, silently falling back to UTC for
    // every later test in this worker.
    expect(process.env.TZ).toBeUndefined();
    expect("TZ" in process.env).toBe(false);
  });
});

describe("restoreHostTimeZoneAfterEach", () => {
  restoreHostTimeZoneAfterEach();
  const hostTimeZone = process.env.TZ;

  it("lets a test override the timezone", () => {
    applyTimeZone("Pacific/Kiritimati");
    expect(process.env.TZ).toBe("Pacific/Kiritimati");
  });

  it("has put the host timezone back for the next test", () => {
    expect(process.env.TZ).toBe(hostTimeZone);
  });
});
