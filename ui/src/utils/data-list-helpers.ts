export function moveItemByOne<T>(
  array: Array<T>,
  idx: number,
  direction: "up" | "down",
): Array<T> {
  const newArray = array.slice();
  const item: T = newArray[idx];

  if (idx === 0 && direction === "up") return newArray;
  if (idx === array.length - 1 && direction === "down") return newArray;

  newArray.splice(idx, 1);
  const offset = direction === "up" ? -1 : 1;
  newArray.splice(idx + offset, 0, item);
  return newArray;
}

/**
 * moveItemByOne addressed by the item's id rather than its position, so
 * callers rendering a filtered or reordered view never act on the wrong
 * element. Unknown ids are a no-op.
 */
export function moveItemByIdByOne<T extends { id: string }>(
  array: Array<T>,
  id: string,
  direction: "up" | "down",
): Array<T> {
  const idx = array.findIndex((item) => item.id === id);
  if (idx === -1) return array.slice();
  return moveItemByOne(array, idx, direction);
}

/** A copy of array without the item carrying id (no-op for unknown ids). */
export function removeItemById<T extends { id: string }>(
  array: Array<T>,
  id: string,
): Array<T> {
  return array.filter((item) => item.id !== id);
}
