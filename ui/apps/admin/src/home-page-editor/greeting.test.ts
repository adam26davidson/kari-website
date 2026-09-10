import { describe, it, expect } from "vitest";
import { greetingFor } from "./greeting";

describe("greetingFor", () => {
  // Both sides of each boundary: the split points are a taste call, so they
  // are pinned here rather than left to drift.
  it.each([
    [0, "Good morning, Kari"],
    [11, "Good morning, Kari"],
    [12, "Good afternoon, Kari"],
    [17, "Good afternoon, Kari"],
    [18, "Good evening, Kari"],
    [23, "Good evening, Kari"],
  ])("greets at %i with %s", (hour, expected) => {
    expect(greetingFor(hour, "Kari Davidson")).toBe(expected);
  });

  it("uses the first name only, however long the full name is", () => {
    expect(greetingFor(9, "Kari Anne Davidson")).toBe("Good morning, Kari");
  });

  // Auth0 falls back to the email address when an account has no name set
  // (#573). "Good morning, kari@example.com" is not a welcome.
  it("greets without a name when the name is really an email address", () => {
    expect(greetingFor(9, "kari@example.com")).toBe("Good morning");
  });

  it("greets without a name when there is no name at all", () => {
    expect(greetingFor(14, "")).toBe("Good afternoon");
    expect(greetingFor(20, "   ")).toBe("Good evening");
  });
});
