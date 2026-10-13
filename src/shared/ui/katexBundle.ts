// Single static-import aggregator for KaTeX. Pulling it in via one dynamic
// `import()` (see markdownMath.ts) emits one chunk with the library and its
// stylesheet, kept out of the initial bundle.
import katex from "katex";
import "katex/dist/katex.min.css";

export { katex };
