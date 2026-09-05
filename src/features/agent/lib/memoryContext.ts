/**
 * Shapes the memory bundle's index.md into the `<memory-index>` block that is
 * attached to each request as runtime context. Codex truncates its always-loaded
 * memory summary at a fixed token budget; we do the same by bytes so a large
 * bundle can't crowd out the conversation.
 */

/** Byte budget for the injected index (roughly 1.5k tokens). */
export const MEMORY_INDEX_MAX_BYTES = 6 * 1024;

const FRONTMATTER_PREFIX = /^---\s*\n[\s\S]*?\n---\s*\n*/;

/** Drop the index file's own frontmatter (okf_version) — plumbing the model doesn't need. */
export function stripIndexFrontmatter(indexMarkdown: string): string {
  return indexMarkdown.replace(FRONTMATTER_PREFIX, "").trim();
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Truncate an index body to whole lines within `maxBytes`, appending a pointer
 * to the tools when entries had to be dropped.
 */
export function truncateMemoryIndex(indexBody: string, maxBytes: number = MEMORY_INDEX_MAX_BYTES): string {
  if (byteLength(indexBody) <= maxBytes) return indexBody;

  const kept: string[] = [];
  let used = 0;
  let dropping = false;
  let droppedEntries = 0;

  for (const line of indexBody.split("\n")) {
    const cost = byteLength(line) + 1;
    if (dropping || (kept.length > 0 && used + cost > maxBytes)) {
      dropping = true;
      if (line.startsWith("*")) droppedEntries++;
      continue;
    }
    kept.push(line);
    used += cost;
  }

  const note =
    droppedEntries > 0
      ? `* … ${droppedEntries} more ${droppedEntries === 1 ? "entry" : "entries"} not shown — use the memory tool's search op to find one.`
      : "* … index truncated — use the memory tool's search op to find an entry.";
  return `${kept.join("\n").trimEnd()}\n${note}`;
}

/** Full runtime-context block for the memory provider. */
export function buildMemoryRuntimeContext(indexMarkdown: string, maxBytes: number = MEMORY_INDEX_MAX_BYTES): string {
  const body = truncateMemoryIndex(stripIndexFrontmatter(indexMarkdown), maxBytes);
  return `<memory-index>\n${body || "_No memories yet._"}\n</memory-index>`;
}
