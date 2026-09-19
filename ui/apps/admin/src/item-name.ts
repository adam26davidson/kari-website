/**
 * The first of `candidates` with any text in it, tidied for display.
 *
 * Names come from free-text fields, so a "name" may carry newlines or runs
 * of spaces — a haiku's first line and a post's title both arrive exactly
 * as she typed them. Whitespace is collapsed to one space so the result can
 * sit inside a sentence.
 *
 * `undefined` when nothing has been written yet: a draft she added and has
 * not filled in has no name, and callers say so in their own words rather
 * than showing an empty pair of quotes.
 *
 * Shared because two places need the same answer about the same item — the
 * delete confirmation she reads, and what the helper is told she has open
 * (`assistant/use-assistant-subject.ts`). They must not disagree.
 */
export function itemName(
  ...candidates: Array<string | undefined>
): string | undefined {
  return candidates
    .map((candidate) => candidate?.replace(/\s+/g, " ").trim() ?? "")
    .find((candidate) => candidate.length > 0);
}
