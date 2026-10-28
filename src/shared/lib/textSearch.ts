/** Literal, case-insensitive matching without changing UTF-16 offsets (e.g. Turkish İ). */
export function textMatches(text: string, query: string): { index: number; text: string }[] {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(text.matchAll(new RegExp(escaped, "giu")), (match) => ({ index: match.index, text: match[0] }));
}

/** Ranges span inline Markdown elements without modifying React's DOM. */
export function findTextRanges(element: HTMLElement, query: string): Range[] {
  const nodes: { node: Text; start: number; end: number }[] = [];
  let content = "";
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest('button, script, style, textarea, [hidden], [aria-hidden="true"]') ||
      !parent.getClientRects().length
    )
      continue;
    nodes.push({ node, start: content.length, end: content.length + node.length });
    content += node.data;
  }
  return textMatches(content, query).flatMap((match) => {
    const end = match.index + match.text.length;
    const first = nodes.find((node) => node.end > match.index);
    const last = nodes.find((node) => node.end >= end);
    if (!first || !last) return [];
    const range = document.createRange();
    range.setStart(first.node, match.index - first.start);
    range.setEnd(last.node, end - last.start);
    return [range];
  });
}
