/**
 * How much of an item's name the dialog will show. Long enough for a
 * haiku's first line or a post title, short enough that the 440px dialog
 * stays a question rather than becoming an excerpt.
 */
const MAX_NAME_LENGTH = 60;

/**
 * The message a delete confirmation shows, naming the item it is about
 * ("Delete the haiku "old pond"?") so she can tell she is deleting the
 * right one, rather than the interchangeable "Are you sure you want to
 * delete this haiku?" every row used to ask (design brief §6).
 *
 * Candidates are tried in order and the first with any text wins, so a
 * caller can pass a haiku's lines (spread) or a post's title and subtitle
 * without checking them itself. An item with nothing to name it — a draft
 * she added and has not written yet — gets the untitled wording instead of
 * an empty pair of quotes.
 */
export function deleteConfirmationMessage(
  noun: string,
  ...candidateNames: Array<string | undefined>
): string {
  const name = candidateNames
    // Names come from free-text fields, so a "name" may carry newlines or
    // runs of spaces that would wrap the dialog into a paragraph.
    .map((candidate) => candidate?.replace(/\s+/g, " ").trim() ?? "")
    .find((candidate) => candidate.length > 0);
  if (!name) return `Delete this untitled ${noun}?`;
  const shortened =
    name.length > MAX_NAME_LENGTH
      ? `${name.slice(0, MAX_NAME_LENGTH).trimEnd()}...`
      : name;
  return `Delete the ${noun} "${shortened}"?`;
}
