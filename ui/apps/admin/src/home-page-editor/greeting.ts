/**
 * The home page's title: the time of day, and her name if we have one.
 *
 * Only the home page greets — every other section is titled after what it
 * holds — so this lives with the home editor rather than in `components/`.
 *
 * The name is the FIRST word of the signed-in account's display name, and
 * only when that name looks like a name. Auth0 falls back to the email
 * address for an account with no name set (#573), and "Good morning,
 * adam26davidson@gmail.com" is not the welcome the design brief asks for —
 * so an empty name, or one carrying an `@`, gets the bare greeting instead.
 *
 * The boundaries (noon, 18:00) are a taste call rather than a fact; they are
 * pinned in greeting.test.ts so a change to them is a decision, not a drift.
 */
export function greetingFor(hour: number, name: string): string {
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = name.trim().split(/\s+/)[0];
  const usable = firstName !== "" && !firstName.includes("@");
  return usable ? `Good ${timeOfDay}, ${firstName}` : `Good ${timeOfDay}`;
}
