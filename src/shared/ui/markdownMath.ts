// Lazy KaTeX wiring for the markdown renderer.
//
// KaTeX plus its stylesheet and fonts is ~250 KB and only matters for content
// that contains math. The whole stack loads on first use as a single chunk
// (see katexBundle); the dynamic import() is itself the cache.

export type Katex = typeof import("katex").default;

/** Load KaTeX (and its stylesheet) for `$$` math nodes and ```latex fences. */
export async function loadKatex(): Promise<Katex> {
  return (await import("./katexBundle")).katex;
}
