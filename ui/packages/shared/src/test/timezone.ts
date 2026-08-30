import { afterEach } from "vitest";

/**
 * Sets the process timezone, where `undefined` means "the host's own
 * zone".
 *
 * `process.env.TZ = undefined` does NOT do that: Node stringifies the
 * assignment, so TZ becomes the literal string "undefined", which ICU
 * rejects and falls back to UTC. Since TZ is normally unset (locally and
 * in CI), a naive restore would silently run every later test in the
 * worker in UTC — hiding exactly the timezone bugs these tests exist to
 * catch. Unsetting has to be a `delete`.
 */
export function applyTimeZone(timeZone: string | undefined): void {
  if (timeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = timeZone;
  }
}

/**
 * Call at the top of a `describe` whose tests change `process.env.TZ`:
 * captures the host timezone now and puts it back after every test.
 */
export function restoreHostTimeZoneAfterEach(): void {
  const hostTimeZone = process.env.TZ;
  afterEach(() => applyTimeZone(hostTimeZone));
}
