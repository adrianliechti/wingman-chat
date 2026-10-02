export const MAX_FETCH_CHARS = 12000;
export const DEFAULT_FETCH_CHARS = 6000;

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated, ${text.length - max} more chars]`;
}

/** Return source text verbatim, with offsets so excerpts cannot imply full coverage. */
export function pageExcerpt(text: string, query: string, offset: number, maxChars: number): string {
  if (!text.trim()) return "_No text content could be extracted._";
  if (offset >= text.length) return `_Offset ${offset} is past the end (${text.length} characters)._`;
  if (!query || text.length <= maxChars) {
    const end = Math.min(text.length, offset + maxChars);
    return `[Characters ${offset}–${end} of ${text.length}]\n${text.slice(offset, end)}${end < text.length ? `\n\n[More text available: use offset=${end}, or query to select relevant passages.]` : ""}`;
  }

  // Overlapping windows preserve phrases across boundaries. Distinct query
  // terms rank passages; this is lexical extraction, never a generated summary.
  const allTerms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  const terms = allTerms.some((term) => term.length > 1) ? allTerms.filter((term) => term.length > 1) : allTerms;
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const phrase = normalize(query);
  const windows: { start: number; end: number; score: number; matches: string[] }[] = [];
  const windowChars = Math.min(1400, maxChars);
  for (let start = 0; start < text.length; start += windowChars - 400) {
    const end = Math.min(text.length, start + windowChars);
    const lower = text.slice(start, end).toLowerCase();
    const matches = terms.filter((term) => lower.includes(term));
    if (matches.length) {
      // Exact phrases and section headings outrank scattered/common words in
      // captions and navigation. Normalize punctuation for e.g. curly quotes.
      const headingMatch = lower.split("\n").some((line) => /^#{1,6}\s/.test(line) && normalize(line).includes(phrase));
      const score = Number(normalize(lower).includes(phrase)) * 2 + Number(headingMatch) * 4;
      windows.push({ start, end, score, matches });
    }
  }
  if (!windows.length) {
    return `[No literal query terms matched. Showing the beginning; this does not establish absence of evidence.]\n${pageExcerpt(text, "", 0, maxChars)}`;
  }
  const frequency = new Map(
    terms.map((term) => [term, windows.filter((window) => window.matches.includes(term)).length]),
  );
  for (const window of windows) {
    window.score += window.matches.reduce((sum, term) => sum + Math.log(1 + windows.length / frequency.get(term)!), 0);
  }
  windows.sort((a, b) => b.score - a.score || a.start - b.start);
  const selected: typeof windows = [];
  let remaining = maxChars;
  for (const window of windows) {
    if (remaining <= 0) break;
    if (selected.some((other) => window.start < other.end && window.end > other.start)) continue;
    if (window.end - window.start > remaining) continue;
    selected.push(window);
    remaining -= window.end - window.start;
  }
  return `[Selected excerpts from ${text.length} characters; other passages omitted. Use offset without query to read sequentially.]\n${selected
    .sort((a, b) => a.start - b.start)
    .map(({ start, end }) => `[Characters ${start}–${end}]\n${text.slice(start, end)}`)
    .join("\n\n[…]\n\n")}`;
}
