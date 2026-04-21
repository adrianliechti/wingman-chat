/**
 * Static HTML→PPTX XML parser.
 *
 * Mounts each HTML slide in an iframe, walks the DOM to extract text,
 * images, and shapes with their computed positions, then generates a
 * draft `<p:sld>` XML document. The output has correct content but may
 * have imprecise layout — intended to be refined by an LLM in a second pass.
 */

// ── Constants ───────────────────────────────────────────────────────────────

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const SLIDE_CX = 9144000;
const SLIDE_CY = 5143500;
const EMU_PER_PX = SLIDE_CX / CANVAS_W;

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParsedParagraph {
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  textAlign?: string;
  isBullet?: boolean;
}

export interface ParsedElement {
  type: "text" | "image" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  lineHeight?: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  textAlign?: string;
  paragraphs?: ParsedParagraph[];
  backgroundColor?: string;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  imageData?: string;
}

export interface ParsedSlide {
  background: string;
  elements: ParsedElement[];
}

export interface StaticSlideResult {
  xml: string;
  images: Map<string, string>; // filename → dataURL
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse an assembled HTML slide and produce draft PPTX XML + extracted images.
 */
export async function parseAndBuildSlide(
  html: string,
  slideIndex: number,
): Promise<StaticSlideResult> {
  const slide = await parseSlideHtml(html);
  const images = new Map<string, string>();
  const imageTokens = new Map<number, string>(); // element index → img_ token

  let imgCounter = 0;
  for (let i = 0; i < slide.elements.length; i++) {
    const el = slide.elements[i];
    if (el.type === "image" && el.imageData) {
      imgCounter++;
      const name = `s${slideIndex}_img${imgCounter}`;
      const ext = el.imageData.startsWith("data:image/jpeg") ? "jpeg" : "png";
      const filename = `${name}.${ext}`;
      images.set(filename, el.imageData);
      imageTokens.set(i, `img_${name}`);
    }
  }

  const xml = buildSlideXml(slide, imageTokens);
  return { xml, images };
}

// ── DOM Parser ──────────────────────────────────────────────────────────────

export async function parseSlideHtml(html: string): Promise<ParsedSlide> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.width = `${CANVAS_W}px`;
  iframe.style.height = `${CANVAS_H}px`;
  iframe.style.border = "none";
  iframe.style.overflow = "hidden";
  iframe.srcdoc = html;

  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
  });

  try {
    await iframe.contentDocument?.fonts.ready;
  } catch {
    // ignore
  }

  const doc = iframe.contentDocument!;
  const win = iframe.contentWindow!;
  const body = doc.body;

  const bodyStyle = win.getComputedStyle(body);
  let background = bodyStyle.backgroundColor || "rgb(255, 255, 255)";

  if (background === "rgba(0, 0, 0, 0)" || background === "transparent") {
    const firstChild = body.firstElementChild;
    if (firstChild) {
      const childStyle = win.getComputedStyle(firstChild);
      background = childStyle.backgroundColor || "rgb(255, 255, 255)";
    }
  }

  const elements: ParsedElement[] = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  const visited = new Set<Element>();

  let node: Element | null = walker.currentNode as Element;
  while (node) {
    if (node !== body && !visited.has(node)) {
      visited.add(node);
      const el = node as HTMLElement;
      const style = win.getComputedStyle(el);

      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        node = walker.nextNode() as Element | null;
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        node = walker.nextNode() as Element | null;
        continue;
      }

      // SVG → rasterize
      if (el.tagName === "SVG" || el.tagName === "svg") {
        const dataUrl = await rasterizeSvg(el as unknown as SVGSVGElement, rect.width, rect.height);
        if (dataUrl) {
          elements.push({ type: "image", x: rect.left, y: rect.top, w: rect.width, h: rect.height, imageData: dataUrl });
        }
        skipChildren(walker, el);
        node = walker.nextNode() as Element | null;
        continue;
      }

      // IMG
      if (el.tagName === "IMG") {
        const dataUrl = await getImageDataUrl(el as HTMLImageElement);
        if (dataUrl) {
          elements.push({ type: "image", x: rect.left, y: rect.top, w: rect.width, h: rect.height, imageData: dataUrl });
        }
        node = walker.nextNode() as Element | null;
        continue;
      }

      const isLeaf = isLeafTextBlock(el);
      const hasBg = style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
      const hasBorder = style.borderWidth !== "0px" && style.borderStyle !== "none";

      if ((hasBg || hasBorder) && !isLeaf) {
        elements.push({
          type: "shape",
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
          backgroundColor: hasBg ? style.backgroundColor : undefined,
          borderRadius: parseFloat(style.borderRadius) || 0,
          borderColor: hasBorder ? style.borderColor : undefined,
          borderWidth: hasBorder ? parseFloat(style.borderWidth) || 0 : 0,
          opacity: parseFloat(style.opacity),
        });
      }

      if (isLeaf) {
        const paragraphs = extractParagraphs(el, win);
        if (paragraphs.length > 0) {
          elements.push({
            type: "text",
            x: rect.left, y: rect.top, w: rect.width, h: rect.height,
            fontSize: parseFloat(style.fontSize) || 16,
            fontFamily: style.fontFamily?.split(",")[0]?.replace(/["']/g, "").trim() || "Calibri",
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            color: style.color,
            textAlign: style.textAlign,
            paragraphs,
          });
          skipChildren(walker, el);
        }
      }
    }
    node = walker.nextNode() as Element | null;
  }

  document.body.removeChild(iframe);
  return { background, elements };
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

/**
 * Check if this element is a "leaf text block" — an element that contains
 * text and has no block-level children that would create their own text boxes.
 * This prevents duplicate extraction (parent AND child both becoming text boxes).
 */
function isLeafTextBlock(el: HTMLElement): boolean {
  const text = el.textContent?.trim();
  if (!text) return false;

  // Must have some text content (direct text nodes or inline children)
  const blockTags = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "NAV", "ASIDE", "HEADER", "FOOTER", "UL", "OL", "TABLE", "FIGURE"]);

  // If this is a pure container (div, section) with block children, skip it —
  // the children will be visited by the walker individually
  if (blockTags.has(el.tagName)) {
    // Only treat as leaf if ALL children are inline (no block subdivisions)
    for (const child of el.children) {
      if (blockTags.has(child.tagName) || ["H1", "H2", "H3", "H4", "H5", "H6", "P", "BLOCKQUOTE", "PRE", "LI"].includes(child.tagName)) {
        return false;
      }
    }
  }

  // Text-bearing tags or elements with direct text nodes
  const textTags = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE", "PRE", "FIGCAPTION", "TD", "TH", "DT", "DD", "LABEL"]);
  if (textTags.has(el.tagName)) return true;

  // Inline wrappers (span, a, strong, em) — only if they're the top-level text container
  // (i.e., their parent is a non-text container like div)
  const inlineTags = new Set(["SPAN", "A", "STRONG", "EM", "B", "I", "CODE"]);
  if (inlineTags.has(el.tagName)) {
    // Only extract if parent wouldn't be extracted
    const parent = el.parentElement;
    if (parent && !textTags.has(parent.tagName) && !inlineTags.has(parent.tagName)) {
      return true;
    }
    return false; // parent will handle this
  }

  // Generic divs with only inline content
  if (el.tagName === "DIV") {
    // Check it has direct text nodes
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) return true;
    }
  }

  return false;
}

function extractParagraphs(el: HTMLElement, win: Window): ParsedParagraph[] {
  const style = win.getComputedStyle(el);

  // Lists: each LI is a paragraph
  if (el.tagName === "UL" || el.tagName === "OL") {
    return [...el.querySelectorAll("li")].map((li) => {
      const liStyle = win.getComputedStyle(li);
      return {
        text: li.textContent?.trim() || "",
        fontSize: parseFloat(liStyle.fontSize) || parseFloat(style.fontSize) || 16,
        fontFamily: liStyle.fontFamily?.split(",")[0]?.replace(/["']/g, "").trim() || "Calibri",
        fontWeight: liStyle.fontWeight,
        fontStyle: liStyle.fontStyle,
        color: liStyle.color,
        textAlign: liStyle.textAlign,
        isBullet: true,
      };
    }).filter((p) => p.text);
  }

  // Single text element → single paragraph
  const text = el.textContent?.trim();
  if (!text) return [];

  return [{
    text,
    fontSize: parseFloat(style.fontSize) || 16,
    fontFamily: style.fontFamily?.split(",")[0]?.replace(/["']/g, "").trim() || "Calibri",
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: style.color,
    textAlign: style.textAlign,
  }];
}

function skipChildren(walker: TreeWalker, parent: Element) {
  let next = walker.nextNode() as Element | null;
  while (next && parent.contains(next)) {
    next = walker.nextNode() as Element | null;
  }
  if (next) walker.previousNode();
}

async function rasterizeSvg(svg: SVGSVGElement, width: number, height: number): Promise<string | null> {
  try {
    const svgStr = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width * 2, height * 2);
    URL.revokeObjectURL(url);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function getImageDataUrl(img: HTMLImageElement): Promise<string | null> {
  if (img.src.startsWith("data:")) return img.src;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// ── PPTX XML builders ──────────────────────────────────────────────────────

function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

function cssColorToHex(color: string): string {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10).toString(16).padStart(2, "0");
    const g = parseInt(match[2], 10).toString(16).padStart(2, "0");
    const b = parseInt(match[3], 10).toString(16).padStart(2, "0");
    return `${r}${g}${b}`.toUpperCase();
  }
  if (color.startsWith("#")) return color.slice(1).padEnd(6, "0").toUpperCase();
  return "000000";
}

// Slide is 720pt wide (10" × 72pt) across CANVAS_W=1920px → 0.375 pt per CSS px.
// PPTX `sz` is in hundredths of a point, so multiply by 100.
const PT_PER_PX = (SLIDE_CX / 914400) * 72 / 1920; // = 0.375
function fontSizeToPptx(px: number): number {
  return Math.round(px * PT_PER_PX * 100);
}

function isBold(weight: string | undefined): boolean {
  if (!weight) return false;
  return weight === "bold" || weight === "bolder" || parseInt(weight, 10) >= 700;
}

function alignmentToPptx(align: string | undefined): string {
  switch (align) {
    case "center": return "ctr";
    case "right": return "r";
    case "justify": return "just";
    default: return "l";
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSlideXml(slide: ParsedSlide, imageTokens: Map<number, string>): string {
  const bgHex = cssColorToHex(slide.background);
  const bgXml =
    bgHex === "FFFFFF" || (bgHex === "000000" && slide.background.includes("0, 0, 0, 0"))
      ? ""
      : `\n    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bgHex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;

  const shapes: string[] = [];
  let nextId = 2;

  for (let i = 0; i < slide.elements.length; i++) {
    const el = slide.elements[i];
    const id = nextId++;
    const x = pxToEmu(el.x);
    const y = pxToEmu(el.y);
    const cx = pxToEmu(el.w);
    const cy = pxToEmu(el.h);

    if (el.type === "image") {
      const token = imageTokens.get(i);
      if (!token) continue;
      shapes.push(`    <p:pic>
      <p:nvPicPr><p:cNvPr id="${id}" name="Image ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="${token}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>`);
    } else if (el.type === "shape") {
      const prst = el.borderRadius && el.borderRadius > 5 ? "roundRect" : "rect";
      const fillXml = el.backgroundColor
        ? `<a:solidFill><a:srgbClr val="${cssColorToHex(el.backgroundColor)}"/></a:solidFill>`
        : "<a:noFill/>";
      const lineXml = el.borderColor && el.borderWidth
        ? `<a:ln w="${Math.round(el.borderWidth * 12700)}"><a:solidFill><a:srgbClr val="${cssColorToHex(el.borderColor)}"/></a:solidFill></a:ln>`
        : "<a:ln><a:noFill/></a:ln>";

      shapes.push(`    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
        <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
        ${fillXml}
        ${lineXml}
      </p:spPr>
    </p:sp>`);
    } else if (el.type === "text" && el.paragraphs?.length) {
      const parasXml = el.paragraphs.map((p) => {
        const sz = fontSizeToPptx(p.fontSize || el.fontSize || 16);
        const bold = isBold(p.fontWeight || el.fontWeight) ? ' b="1"' : "";
        const italic = (p.fontStyle || el.fontStyle) === "italic" ? ' i="1"' : "";
        const colorHex = cssColorToHex(p.color || el.color || "rgb(0,0,0)");
        const font = p.fontFamily || el.fontFamily || "Calibri";
        const align = alignmentToPptx(p.textAlign || el.textAlign);
        const bulletXml = p.isBullet ? `<a:buFont typeface="Arial"/><a:buChar char="&#x2022;"/>` : "";

        return `      <a:p>
        <a:pPr algn="${align}"${p.isBullet ? ' marL="342900" indent="-342900"' : ""}>${bulletXml}</a:pPr>
        <a:r>
          <a:rPr lang="en-US" sz="${sz}"${bold}${italic} dirty="0">
            <a:solidFill><a:srgbClr val="${colorHex}"/></a:solidFill>
            <a:latin typeface="${escapeXml(font)}"/>
          </a:rPr>
          <a:t>${escapeXml(p.text)}</a:t>
        </a:r>
      </a:p>`;
      }).join("\n");

      shapes.push(`    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" rtlCol="0" anchor="t"/>
        <a:lstStyle/>
${parasXml}
      </p:txBody>
    </p:sp>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>${bgXml}
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${shapes.join("\n")}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}
