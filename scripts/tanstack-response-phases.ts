import type { Plugin } from "vite-plus";

/** Temporary @tanstack/openai-base 1.0.2 fix; remove after upstream ships item lengths. */
// https://github.com/TanStack/ai/pull/2087
export function tanstackResponsePhases(): Plugin {
  return {
    name: "tanstack-response-phases",
    enforce: "pre",
    transform: {
      filter: { id: /[/\\]@tanstack[/\\]openai-base[/\\]dist[/\\]esm[/\\]adapters[/\\]responses-text\.js$/ },
      handler(code) {
        const countGuard = "if (!items || items.length !== texts.length) return void 0;";
        const textBlocks = "const texts = orderedAssistantBlocks(message)";
        const capture = /id: item\.id,\n(\s*)\.\.\.item\.phase \? \{ phase: item\.phase \} : \{\}/;
        if (!code.includes(countGuard) || !code.includes(textBlocks) || !capture.test(code))
          this.error("TanStack phase patch no longer matches; check whether upstream fixed answer-item replay.");
        return {
          code: code
            .replace(textBlocks, "let texts = orderedAssistantBlocks(message)")
            .replace(
              countGuard,
              `
              if (!items) return;
              if (items.length !== texts.length) {
                const lengths = items.map(item => item.textLength);
                if (!lengths.every(length => Number.isInteger(length) && length >= 0) ||
                    lengths.reduce((sum, length) => sum + length, 0) !== text.length) return;
                let offset = 0;
                texts = lengths.map(length => text.slice(offset, offset += length));
              }
            `,
            )
            .replace(
              capture,
              `id: item.id,
              textLength: item.content.reduce((length, part) => length + (part.type === "output_text" ? part.text.length : 0), 0),
              ...item.phase ? { phase: item.phase } : {}`,
            ),
          map: null,
        };
      },
    },
  };
}
