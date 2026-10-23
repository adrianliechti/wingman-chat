export interface ImageStyle {
  name: string;
  /** Grouping from the nearest `##`/`###` heading above the style (for the picker). */
  category: string;
  /** Prompt fragment appended to the image request when this style is chosen. */
  prompt: string;
}

/**
 * Parse named image styles out of the canvas-design style reference. Each style is a
 * markdown bullet of the form `- **Name** — fragment` (em dash, en dash, or plain
 * hyphen), grouped under category headings. The Canvas picker and model read
 * the same served reference, independently of the skill's task instructions.
 */
export function parseImageStyles(markdown: string): ImageStyle[] {
  const styles: ImageStyle[] = [];
  let category = "";
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^#{2,4}\s+(.+\S)\s*$/);
    if (heading) {
      category = heading[1].trim();
      continue;
    }
    const match = line.match(/^\s*-\s*\*\*(.+?)\*\*\s*[—–-]\s*(.+\S)\s*$/);
    if (match) styles.push({ name: match[1].trim(), category, prompt: match[2].trim() });
  }
  return styles;
}
