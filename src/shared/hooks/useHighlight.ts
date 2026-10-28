import type { Highlighter } from "@tanstack/highlight";
import { useEffect, useMemo, useState } from "react";

let highlighterLoad: Promise<Highlighter> | undefined;

/** Highlight is synchronous; keep large streamed blocks and editor buffers as plain text. */
const MAX_HIGHLIGHT_LENGTH = 30_000;

/** Share all bundled languages between code blocks and source editors, loaded on first use. */
function loadHighlighter(): Promise<Highlighter> {
  return (highlighterLoad ??= import("@tanstack/highlight")
    .then(({ defaultHighlighter }) => defaultHighlighter)
    .catch((error: unknown) => {
      highlighterLoad = undefined;
      throw error;
    }));
}

/** Once loaded, tokenize during render so the mirror always matches the current source. */
export function useHighlight(code: string, language: string | undefined) {
  const lang = code.length <= MAX_HIGHLIGHT_LENGTH ? language : undefined;
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  useEffect(() => {
    if (!lang) return;
    let live = true;
    loadHighlighter().then(
      (loaded) => {
        if (live) setHighlighter(loaded);
      },
      (error: unknown) => console.error("Syntax highlighting failed to load:", error),
    );
    return () => {
      live = false;
    };
  }, [lang]);
  return useMemo(
    () => (highlighter && lang ? highlighter.tokenize(code, { lang }).tokens : null),
    [highlighter, code, lang],
  );
}
