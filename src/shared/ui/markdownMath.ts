// Lazy KaTeX wiring for the markdown renderer.
//
// KaTeX plus its stylesheet/fonts is ~250 KB and only matters for content that
// contains math. Keeping it out of `Markdown.tsx`'s static imports keeps it out
// of the initial bundle; the whole stack loads on first use as a single chunk
// (see katexBundle). The dynamic import() is itself the cache — Vite/ESM fetch
// and evaluate the chunk exactly once and hand the same namespace to every
// later caller.

/** The two math plugins the markdown pipeline wires in once math is detected. */
export type MathPlugins = {
  remarkMath: typeof import("remark-math").default;
  rehypeKatex: typeof import("rehype-katex").default;
};

// One dynamic import → one chunk for the entire KaTeX stack.
const loadKatexBundle = () => import("./katexBundle");

/**
 * Load the remark/rehype math plugins (and the KaTeX stylesheet). Wired into the
 * unified pipeline only when rendered content contains `$$…$$` math.
 */
export async function loadMathPlugins(): Promise<MathPlugins> {
  const { remarkMath, rehypeKatex } = await loadKatexBundle();
  return { remarkMath, rehypeKatex };
}

/** Load KaTeX itself for direct rendering of ```latex/```math fences. */
export async function loadKatex(): Promise<typeof import("katex").default> {
  return (await loadKatexBundle()).katex;
}

/** True when preprocessed markdown contains `$$…$$` math the KaTeX pipeline must handle. */
export function contentHasMath(text: string): boolean {
  return text.includes("$$");
}
