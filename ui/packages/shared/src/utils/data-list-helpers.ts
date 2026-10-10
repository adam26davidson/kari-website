/**
 * A copy of array with the item carrying id shifted one place in the
 * given direction. Addressing by id rather than by position means callers
 * rendering a filtered or reordered view never act on the wrong element.
 * Unknown ids, and moves off either end of the list, are a no-op.
 */
export function moveItemByIdByOne<T extends { id: string }>(
  array: Array<T>,
  id: string,
  direction: "up" | "down",
): Array<T> {
  const newArray = array.slice();
  const idx = newArray.findIndex((item) => item.id === id);
  if (idx === -1) return newArray;
  if (idx === 0 && direction === "up") return newArray;
  if (idx === newArray.length - 1 && direction === "down") return newArray;

  const [item] = newArray.splice(idx, 1);
  newArray.splice(idx + (direction === "up" ? -1 : 1), 0, item);
  return newArray;
}

/** A copy of array without the item carrying id (no-op for unknown ids). */
export function removeItemById<T extends { id: string }>(
  array: Array<T>,
  id: string,
): Array<T> {
  return array.filter((item) => item.id !== id);
}

/**
 * A copy of array with item in place of the entry carrying its id, or with
 * item appended when no entry does. Order is otherwise preserved and the
 * input is never mutated.
 */
export function replaceOrAppendById<T extends { id: string }>(
  array: Array<T>,
  item: T,
): Array<T> {
  const idx = array.findIndex((entry) => entry.id === item.id);
  if (idx === -1) return [...array, item];
  return array.map((entry, i) => (i === idx ? item : entry));
}
