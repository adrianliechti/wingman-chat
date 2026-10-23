/** Sorts active items first, then alphabetically by label. */
export function sortActiveFirst<T>(
  items: readonly T[],
  isActive: (item: T) => boolean,
  label: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || label(a).localeCompare(label(b)));
}
