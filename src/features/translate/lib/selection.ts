/**
 * Character offsets of the live selection inside `container`, whose text
 * content equals `text`. Falls back to the first occurrence of `selected`.
 */
export function selectionOffsets(
  container: HTMLElement,
  text: string,
  selected: string,
): { start: number; end: number } | null {
  const selection = container.ownerDocument.defaultView?.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    if (container.contains(range.commonAncestorContainer)) {
      const before = container.ownerDocument.createRange();
      before.setStart(container, 0);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const end = start + range.toString().length;
      if (end > start && end <= text.length) return { start, end };
    }
  }
  const index = text.indexOf(selected);
  return index < 0 ? null : { start: index, end: index + selected.length };
}

/** Replace the first occurrence of `context` in `text`; unchanged when it is not found. */
export function replaceContext(text: string, context: string, replacement: string): string {
  const index = text.indexOf(context);
  return index < 0 ? text : text.slice(0, index) + replacement + text.slice(index + context.length);
}
