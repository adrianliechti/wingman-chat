import JSZip from "jszip";

/**
 * Converts a DOCX file to GitHub-flavored Markdown.
 *
 * Supported features:
 * - Headings (via pStyle="HeadingN" or outlineLvl)
 * - Paragraphs with proper blank-line separation
 * - Inline runs: bold, italic, strikethrough, monospace/code (via font)
 * - Tabs and line breaks (<w:br/>) in correct order within a run
 * - Hyperlinks (external only)
 * - Bullet and numbered lists (multi-level, with counter tracking)
 * - Tables (flat; nested tables are rendered as text)
 * - Markdown-special-character escaping to avoid accidental formatting
 */
export async function docxToMarkdown(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);

  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) {
    throw new Error("Invalid DOCX: missing word/document.xml");
  }

  const relationships = await parseRelationships(zip);
  const numberingInfo = await parseNumbering(zip);

  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");

  // Check for XML parser errors
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error(`Invalid DOCX: malformed document.xml (${parserError.textContent?.slice(0, 100)})`);
  }

  const body = doc.getElementsByTagName("w:body")[0];
  if (!body) {
    throw new Error("Invalid DOCX: missing document body");
  }

  const ctx: Context = { relationships, numberingInfo, listState: { counters: new Map() } };
  const blocks = renderBlocks(directChildren(body), ctx);

  return joinBlocks(blocks);
}

// ============================================================================
// Types and helpers
// ============================================================================

interface Relationships {
  [rId: string]: string;
}

interface LevelDef {
  isOrdered: boolean;
  start: number;
  format: string; // decimal, lowerLetter, etc.
}

interface NumberingInfo {
  // numId -> ilvl -> LevelDef
  definitions: Map<string, Map<number, LevelDef>>;
}

interface ListState {
  counters: Map<string, number[]>; // numId -> counter per level
}

interface Context {
  relationships: Relationships;
  numberingInfo: NumberingInfo;
  listState: ListState;
}

type BlockKind = "heading" | "paragraph" | "list-item" | "table" | "empty";

interface Block {
  kind: BlockKind;
  text: string; // may contain newlines for table / multi-line block
}

/** Iterate only direct Element children (skips whitespace/text/comment nodes). */
function directChildren(el: Element): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < el.children.length; i++) {
    result.push(el.children[i]);
  }
  return result;
}

/** First direct child with the given tag name, or undefined. */
function directChild(el: Element | undefined, tagName: string): Element | undefined {
  if (!el) return undefined;
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].tagName === tagName) return el.children[i];
  }
  return undefined;
}

/**
 * Interpret a toggle property like <w:b/>, <w:b w:val="true"/>, <w:b w:val="0"/>.
 * Presence with no val, or val="true"/"1"/"on" means enabled.
 * val="false"/"0"/"off" means explicitly disabled.
 */
function isToggleOn(rPr: Element | undefined, tagName: string): boolean {
  if (!rPr) return false;
  const el = directChild(rPr, tagName);
  if (!el) return false;
  const val = el.getAttribute("w:val");
  if (val == null) return true;
  const v = val.toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

// ============================================================================
// Relationships parsing (for hyperlinks)
// ============================================================================

async function parseRelationships(zip: JSZip): Promise<Relationships> {
  const content = await zip.file("word/_rels/document.xml.rels")?.async("string");
  if (!content) return {};

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");
  const rels: Relationships = {};

  const relationships = doc.getElementsByTagName("Relationship");
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i];
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    const targetMode = rel.getAttribute("TargetMode");

    // Only include external hyperlinks
    if (id && target && targetMode === "External") {
      rels[id] = target;
    }
  }

  return rels;
}

// ============================================================================
// Numbering parsing (for lists)
// ============================================================================

const ORDERED_FORMATS = new Set([
  "decimal",
  "decimalZero",
  "lowerLetter",
  "upperLetter",
  "lowerRoman",
  "upperRoman",
  "ordinal",
  "cardinalText",
  "ordinalText",
]);

async function parseNumbering(zip: JSZip): Promise<NumberingInfo> {
  const content = await zip.file("word/numbering.xml")?.async("string");
  const info: NumberingInfo = { definitions: new Map() };
  if (!content) return info;

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");

  // abstractNumId -> (ilvl -> LevelDef)
  const abstractNums = new Map<string, Map<number, LevelDef>>();
  const abstractNumEls = doc.getElementsByTagName("w:abstractNum");

  for (let i = 0; i < abstractNumEls.length; i++) {
    const abstractNum = abstractNumEls[i];
    const abstractNumId = abstractNum.getAttribute("w:abstractNumId");
    if (!abstractNumId) continue;

    const levels = new Map<number, LevelDef>();
    const lvlEls = abstractNum.getElementsByTagName("w:lvl");
    for (let j = 0; j < lvlEls.length; j++) {
      const lvl = lvlEls[j];
      const ilvl = parseInt(lvl.getAttribute("w:ilvl") || "0", 10);
      const numFmtEl = directChild(lvl, "w:numFmt");
      const startEl = directChild(lvl, "w:start");

      const format = numFmtEl?.getAttribute("w:val") || "bullet";
      const start = parseInt(startEl?.getAttribute("w:val") || "1", 10);
      const isOrdered = ORDERED_FORMATS.has(format);

      levels.set(ilvl, { isOrdered, start, format });
    }

    abstractNums.set(abstractNumId, levels);
  }

  // Resolve numId -> abstractNumId (following lvlOverride chains is simplified).
  const numEls = doc.getElementsByTagName("w:num");
  for (let i = 0; i < numEls.length; i++) {
    const num = numEls[i];
    const numId = num.getAttribute("w:numId");
    const abstractNumIdEl = directChild(num, "w:abstractNumId");
    const abstractNumId = abstractNumIdEl?.getAttribute("w:val");
    const levels = abstractNumId ? abstractNums.get(abstractNumId) : undefined;
    if (numId && levels) {
      info.definitions.set(numId, levels);
    }
  }

  return info;
}

// ============================================================================
// Block-level rendering
// ============================================================================

function renderBlocks(elements: Element[], ctx: Context): Block[] {
  const blocks: Block[] = [];

  for (const child of elements) {
    const tagName = child.tagName;

    if (tagName === "w:p") {
      blocks.push(renderParagraph(child, ctx));
    } else if (tagName === "w:tbl") {
      // Any list context ends at a table boundary.
      ctx.listState.counters.clear();
      const tableText = renderTable(child, ctx);
      if (tableText) {
        blocks.push({ kind: "table", text: tableText });
      }
    } else if (tagName === "w:sdt") {
      // Structured document tag: recurse into <w:sdtContent>.
      const sdtContent = directChild(child, "w:sdtContent");
      if (sdtContent) {
        blocks.push(...renderBlocks(directChildren(sdtContent), ctx));
      }
    }
    // Ignore sectPr and other unknown block-level elements.
  }

  return blocks;
}

/**
 * Join blocks with appropriate separators.
 * - Consecutive list items keep a single newline (tight list).
 * - Everything else is separated by a blank line.
 */
function joinBlocks(blocks: Block[]): string {
  const out: string[] = [];
  let prev: Block | null = null;

  for (const block of blocks) {
    if (block.kind === "empty") continue;

    if (prev !== null) {
      const tight = prev.kind === "list-item" && block.kind === "list-item";
      out.push(tight ? "\n" : "\n\n");
    }
    out.push(block.text);
    prev = block;
  }

  // Normalize: no trailing whitespace on lines, collapse >2 consecutive newlines.
  const joined = out.join("");
  return joined
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

// ============================================================================
// Paragraph rendering
// ============================================================================

function renderParagraph(p: Element, ctx: Context): Block {
  const pPr = directChild(p, "w:pPr");

  // --- Heading detection -----------------------------------------------------
  const pStyle = directChild(pPr, "w:pStyle");
  const styleVal = pStyle?.getAttribute("w:val") || "";

  let headingLevel = 0;
  const styleMatch = styleVal.match(/^heading\s*(\d+)$/i);
  if (styleMatch) {
    headingLevel = parseInt(styleMatch[1], 10);
  } else {
    // Fallback: outlineLvl on the paragraph properties.
    const outlineLvl = directChild(pPr, "w:outlineLvl");
    const outlineVal = outlineLvl?.getAttribute("w:val");
    if (outlineVal) {
      const n = parseInt(outlineVal, 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 8) {
        headingLevel = n + 1;
      }
    }
  }
  if (headingLevel > 6) headingLevel = 6;

  // --- List detection --------------------------------------------------------
  const numPr = directChild(pPr, "w:numPr");
  let listPrefix = "";
  let listIndent = "";
  let isListItem = false;

  if (numPr) {
    const ilvlEl = directChild(numPr, "w:ilvl");
    const numIdEl = directChild(numPr, "w:numId");

    const ilvl = Math.max(0, parseInt(ilvlEl?.getAttribute("w:val") || "0", 10));
    const numId = numIdEl?.getAttribute("w:val") || "";

    // numId="0" means the paragraph is not a list item (Word's "no numbering").
    if (numId && numId !== "0") {
      const levelDefs = ctx.numberingInfo.definitions.get(numId);
      const levelDef = levelDefs?.get(ilvl);

      // Ensure counter array exists.
      let counters = ctx.listState.counters.get(numId);
      if (!counters) {
        counters = [];
        ctx.listState.counters.set(numId, counters);
      }

      // Grow / reset the counters array so each level uses its own start value.
      while (counters.length <= ilvl) {
        const lvl = counters.length;
        const def = levelDefs?.get(lvl);
        counters.push(def?.start ?? 1);
      }

      // Going back to a shallower level: reset each deeper level to its own start.
      for (let i = ilvl + 1; i < counters.length; i++) {
        const def = levelDefs?.get(i);
        counters[i] = def?.start ?? 1;
      }

      listIndent = "  ".repeat(ilvl);
      isListItem = true;

      if (levelDef?.isOrdered) {
        listPrefix = `${counters[ilvl]}. `;
        counters[ilvl]++;
      } else {
        listPrefix = "- ";
      }
    }
  } else {
    // Non-list paragraph ends any in-progress list numbering.
    ctx.listState.counters.clear();
  }

  // --- Inline content --------------------------------------------------------
  const textContent = renderInline(p, ctx.relationships, /*escape*/ true);

  if (!textContent.trim()) {
    return { kind: "empty", text: "" };
  }

  if (headingLevel > 0) {
    // Headings shouldn't contain newlines; collapse any that slipped in.
    const flat = textContent.replace(/\s*\n+\s*/g, " ");
    return { kind: "heading", text: `${"#".repeat(headingLevel)} ${flat}` };
  }

  if (isListItem) {
    // For list items, collapse newlines within the item to avoid breaking the list.
    const flat = textContent.replace(/\s*\n+\s*/g, " ");
    return { kind: "list-item", text: `${listIndent}${listPrefix}${flat}` };
  }

  return { kind: "paragraph", text: textContent };
}

// ============================================================================
// Inline content rendering
// ============================================================================

/**
 * Render the inline children of an element (paragraph or hyperlink) to Markdown.
 * `doEscape` controls whether text in runs is Markdown-escaped (off for table
 * cells where we escape at cell level).
 */
function renderInline(element: Element, relationships: Relationships, doEscape: boolean): string {
  const parts: string[] = [];

  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    const tagName = child.tagName;

    if (tagName === "w:r") {
      parts.push(renderRun(child, doEscape));
    } else if (tagName === "w:hyperlink") {
      const rId = child.getAttribute("r:id");
      const url = rId ? relationships[rId] : undefined;
      const inner = renderInline(child, relationships, doEscape);

      if (url && inner) {
        // Escape parentheses in URL per CommonMark.
        const safeUrl = url.replace(/[()]/g, (c) => `\\${c}`);
        parts.push(`[${inner}](${safeUrl})`);
      } else {
        parts.push(inner);
      }
    } else if (tagName === "w:ins") {
      // Tracked-change insertion: include its content.
      parts.push(renderInline(child, relationships, doEscape));
    } else if (tagName === "w:smartTag" || tagName === "w:fldSimple") {
      // Smart tags and simple fields wrap runs; recurse for their inner text.
      parts.push(renderInline(child, relationships, doEscape));
    } else if (tagName === "w:sdt") {
      const sdtContent = directChild(child, "w:sdtContent");
      if (sdtContent) {
        parts.push(renderInline(sdtContent, relationships, doEscape));
      }
    }
    // w:bookmarkStart, w:bookmarkEnd, w:commentRangeStart/End, w:del,
    // w:proofErr, w:permStart/End etc. are intentionally skipped.
  }

  return parts.join("");
}

function renderRun(r: Element, doEscape: boolean): string {
  const rPr = directChild(r, "w:rPr");

  const isBold = isToggleOn(rPr, "w:b") || isToggleOn(rPr, "w:bCs");
  const isItalic = isToggleOn(rPr, "w:i") || isToggleOn(rPr, "w:iCs");
  const isStrike = isToggleOn(rPr, "w:strike") || isToggleOn(rPr, "w:dstrike");
  const isCode = isMonospaceFont(rPr);

  // Walk the run's children in document order so text, breaks, and tabs
  // interleave correctly.
  let text = "";
  for (let i = 0; i < r.children.length; i++) {
    const c = r.children[i];
    const tag = c.tagName;
    if (tag === "w:t") {
      text += c.textContent ?? "";
    } else if (tag === "w:br") {
      // Markdown hard line break. Note: we avoid the trailing-two-spaces form
      // since it's fragile; a bare "\n" is handled by joinBlocks for paragraphs
      // and collapsed for headings/list items.
      text += "\n";
    } else if (tag === "w:tab") {
      text += "\t";
    } else if (tag === "w:cr") {
      text += "\n";
    } else if (tag === "w:noBreakHyphen") {
      text += "\u2011";
    } else if (tag === "w:softHyphen") {
      // zero-width soft hyphen
      text += "\u00AD";
    } else if (tag === "w:sym") {
      const charHex = c.getAttribute("w:char");
      if (charHex) {
        const code = parseInt(charHex, 16);
        if (!Number.isNaN(code)) text += String.fromCodePoint(code);
      }
    }
    // w:drawing, w:pict, w:object are image/graphic content; skipped.
  }

  if (!text) return "";

  // Escape text inside the run, preserving any \n and \t we produced above.
  // We escape before applying emphasis markers so user content like "*" stays literal.
  if (doEscape && !isCode) {
    text = escapeMarkdown(text);
  }

  // Code wrapping: choose backtick fence long enough to avoid collisions.
  if (isCode) {
    text = wrapInCode(text);
  }
  if (isStrike) text = wrapEmphasis(text, "~~");
  if (isItalic) text = wrapEmphasis(text, "*");
  if (isBold) text = wrapEmphasis(text, "**");

  return text;
}

/**
 * Wrap text in an emphasis marker, keeping leading/trailing whitespace outside
 * the markers (Markdown emphasis may not have adjacent whitespace inside).
 */
function wrapEmphasis(text: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m) return `${marker}${text}${marker}`;
  const [, lead, core, trail] = m;
  if (!core) return text; // nothing to emphasize
  return `${lead}${marker}${core}${marker}${trail}`;
}

function wrapInCode(text: string): string {
  // Find the longest run of backticks in the text; use one more than that.
  const runs = text.match(/`+/g);
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  const fence = "`".repeat(longest + 1);
  // Pad with a space if text begins or ends with a backtick.
  const pad = /^`|`$/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function isMonospaceFont(rPr: Element | undefined): boolean {
  if (!rPr) return false;
  const rFonts = directChild(rPr, "w:rFonts");
  if (!rFonts) return false;

  const ascii = rFonts.getAttribute("w:ascii")?.toLowerCase() || "";
  const hAnsi = rFonts.getAttribute("w:hAnsi")?.toLowerCase() || "";

  const monospaceFonts = [
    "consolas",
    "courier",
    "courier new",
    "monaco",
    "menlo",
    "source code pro",
    "fira code",
    "fira mono",
    "jetbrains mono",
    "cascadia",
    "ibm plex mono",
    "sf mono",
    "roboto mono",
    "ubuntu mono",
    "dejavu sans mono",
    "liberation mono",
  ];

  return monospaceFonts.some((f) => ascii.includes(f) || hAnsi.includes(f));
}

/**
 * Escape characters with special meaning in Markdown inline contexts.
 * We deliberately keep this minimal to avoid uglifying prose:
 *   - Always escape:  \  `  *  _  [  ]  ~
 *   - Not escaped:  - + # > ( ) { } ! | <  (most are only special at line start
 *     or in specific contexts; | is handled at the table-cell level)
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]~])/g, "\\$1");
}

// ============================================================================
// Table rendering
// ============================================================================

function renderTable(tbl: Element, ctx: Context): string {
  // Only direct <w:tr> children — do not descend into nested tables.
  const rows = directChildren(tbl).filter((el) => el.tagName === "w:tr");
  if (rows.length === 0) return "";

  const tableData: string[][] = [];

  for (const row of rows) {
    const cells = directChildren(row).filter((el) => el.tagName === "w:tc");
    const rowData: string[] = [];

    for (const cell of cells) {
      // Only direct <w:p> paragraphs; skip nested tables' paragraphs.
      const paragraphs = directChildren(cell).filter((el) => el.tagName === "w:p");
      const cellTexts: string[] = [];

      for (const p of paragraphs) {
        const text = renderInline(p, ctx.relationships, /*escape*/ true);
        if (text.trim()) {
          cellTexts.push(text.trim());
        }
      }

      // Honour gridSpan by padding with empty cells after this one.
      const tcPr = directChild(cell, "w:tcPr");
      const gridSpanEl = directChild(tcPr, "w:gridSpan");
      const span = Math.max(1, parseInt(gridSpanEl?.getAttribute("w:val") || "1", 10));

      rowData.push(cellTexts.join("<br>"));
      for (let i = 1; i < span; i++) rowData.push("");
    }

    tableData.push(rowData);
  }

  if (tableData.length === 0) return "";

  // Normalize column count.
  const colCount = Math.max(...tableData.map((r) => r.length));
  if (colCount === 0) return "";

  for (const row of tableData) {
    while (row.length < colCount) row.push("");
  }

  const lines: string[] = [];
  const header = tableData[0];
  lines.push(`| ${header.map(escapeTableCell).join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (let i = 1; i < tableData.length; i++) {
    lines.push(`| ${tableData[i].map(escapeTableCell).join(" | ")} |`);
  }

  return lines.join("\n");
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}
