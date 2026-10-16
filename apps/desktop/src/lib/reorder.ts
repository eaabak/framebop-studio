/**
 * Returns `ids` with `id` moved so that it sits before the item currently at
 * `index` (or at the end when `index` equals the list length).
 *
 * `index` refers to positions in the original list, which is what a drop
 * marker between two items means. Because removing the dragged item shifts
 * everything after it one place left, a target after the item's own position
 * has to be adjusted. Returns the same array when nothing would change.
 */
export function moveBefore(
  ids: readonly string[],
  id: string,
  index: number,
): readonly string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const target = Math.min(Math.max(index, 0), ids.length);
  const next = ids.filter((candidate) => candidate !== id);
  next.splice(target > from ? target - 1 : target, 0, id);
  return next.every((candidate, position) => candidate === ids[position])
    ? ids
    : next;
}
