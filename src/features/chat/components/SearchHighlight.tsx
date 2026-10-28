import { textMatches } from "@/shared/lib/textSearch";

/** Plain text only: search input never becomes HTML or Markdown. */
export function SearchHighlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const parts = [];
  let start = 0;
  for (const { index, text: match } of textMatches(text, query)) {
    parts.push(text.slice(start, index));
    parts.push(
      <mark key={index} className="rounded-sm bg-amber-200/70 text-inherit dark:bg-amber-500/35">
        {match}
      </mark>,
    );
    start = index + match.length;
  }
  parts.push(text.slice(start));
  return parts;
}
