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
