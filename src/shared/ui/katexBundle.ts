// Single static-import aggregator for the KaTeX math stack. Pulling it in via
// one dynamic `import()` (see markdownMath.ts) emits ONE chunk containing katex,
// remark-math and rehype-katex — katex is bundled once here instead of being
// duplicated across a standalone katex chunk and rehype-katex's own copy.
import katex from "katex";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

export { katex, rehypeKatex, remarkMath };
