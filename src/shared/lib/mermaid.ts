const MERMAID_PATH_RE = /\.(?:mmd|mermaid)$/i;

export function isMermaidPath(path: string): boolean {
  return MERMAID_PATH_RE.test(path);
}

/** Parse Mermaid source with the same bundled runtime used by the preview. */
export async function validateMermaidSource(source: string): Promise<void> {
  const mermaid = (await import("mermaid")).default;
  await mermaid.parse(source);
}
