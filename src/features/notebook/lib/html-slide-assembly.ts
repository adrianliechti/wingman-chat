/**
 * Assembles raw slide HTML fragments into complete, self-contained HTML documents
 * by injecting shared CSS and resolving image references to data URLs.
 */

/**
 * Get ordered slide HTML content from the filesystem.
 * Filters for slides/slide\d+.html, sorts numerically.
 */
export function getOrderedHtmlSlides(fs: Map<string, string>): string[] {
  return [...fs.entries()]
    .filter(([name]) => /^slides\/slide\d+\.html$/i.test(name))
    .sort(([a], [b]) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
      return numA - numB;
    })
    .map(([, content]) => content);
}

/**
 * Collect all CSS stylesheets from the filesystem, sorted alphabetically.
 */
function collectStyles(fs: Map<string, string>): string[] {
  return [...fs.entries()]
    .filter(([name]) => name.startsWith("styles/") && name.endsWith(".css"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, content]) => content);
}

/**
 * Resolve image path references in HTML/CSS content to data URLs.
 * Handles: src="images/..." and url('images/...') / url("images/...") / url(images/...)
 */
function resolveImagePaths(content: string, fs: Map<string, string>): string {
  return content.replace(/(src=["']|url\(["']?)(images\/[^"')]+)(["']?\)?)/g, (match, prefix, imagePath, suffix) => {
    const dataUrl = fs.get(imagePath);
    if (dataUrl) {
      return `${prefix}${dataUrl}${suffix}`;
    }
    return match;
  });
}

/**
 * Remove tags that would trigger external-network fetches (stylesheets,
 * scripts) from a slide HTML fragment. The model sometimes emits
 * `<link rel="stylesheet" href="styles/theme.css">` even though all
 * stylesheets are inlined at assembly time — this would cause the browser
 * to try to fetch it as a relative URL against the host page, producing a
 * MIME error.
 */
function stripExternalRefs(html: string): string {
  return html.replace(/<link\b[^>]*>/gi, "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

/**
 * Assemble a single slide HTML fragment into a complete, self-contained HTML document.
 * Injects shared CSS, resolves image paths, and wraps in a fixed 960×540 viewport.
 */
export function assembleSlideHtml(slideHtml: string, fs: Map<string, string>): string {
  const styles = collectStyles(fs);

  // Resolve image paths in both styles and slide HTML
  const resolvedStyles = styles.map((css) => resolveImagePaths(css, fs));
  const resolvedSlideHtml = stripExternalRefs(resolveImagePaths(slideHtml, fs));

  const styleBlocks = resolvedStyles.map((css) => `<style>${css}</style>`).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  font-family: var(--font-body, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--ink, #111);
  background: var(--bg, #fff);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: "kern" 1, "liga" 1;
}
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-display, var(--font-body, inherit));
  text-wrap: balance;
  line-height: 1.1;
}
p, li { text-wrap: pretty; line-height: 1.5; }
.kpi, .stat, .hero-number, [data-tabular], svg text { font-variant-numeric: tabular-nums; }
img, svg { max-width: 100%; display: block; }
img { object-fit: cover; }
.slide { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
</style>
${styleBlocks}
</head>
<body>
${resolvedSlideHtml}
</body>
</html>`;
}
