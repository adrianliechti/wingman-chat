import type { ArtifactSelectionContent } from "@/shared/types/chat";

/**
 * Model-facing rendering of a passage the user highlighted in an artifact:
 * a location line followed by the verbatim text in a fence that no backtick
 * run inside the text can close early.
 */
export function formatArtifactSelection(part: ArtifactSelectionContent): string {
  const text = part.text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  const location = part.startLine
    ? part.endLine && part.endLine !== part.startLine
      ? ` (lines ${part.startLine}-${part.endLine})`
      : ` (line ${part.startLine})`
    : "";
  return `Selected text in ${part.path}${location}:\n${fence}\n${text}\n${fence}`;
}
