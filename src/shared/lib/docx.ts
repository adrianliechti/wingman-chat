import JSZip from 'jszip';

/**
 * Converts a DOCX file to GitHub-flavored Markdown
 */
export async function docxToMarkdown(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);

  // Parse relationships for hyperlinks
  const relationships = await parseRelationships(zip);

  // Parse numbering definitions for lists
  const numberingInfo = await parseNumbering(zip);

  // Parse main document
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) {
    throw new Error('Invalid DOCX: missing word/document.xml');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, 'application/xml');

  // Get the document body
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) {
    throw new Error('Invalid DOCX: missing document body');
  }

  const lines: string[] = [];
  const listState: ListState = { counters: new Map() };

  // Process all child elements
  for (const child of body.children) {
    const tagName = child.tagName;

    if (tagName === 'w:p') {
      const line = parseParagraph(child as Element, relationships, numberingInfo, listState);
      lines.push(line);
    } else if (tagName === 'w:tbl') {
      const tableLines = parseTable(child as Element, relationships);
      lines.push(...tableLines);
      lines.push(''); // Empty line after table
    }
  }

  // Clean up output: collapse multiple empty lines
  return cleanupMarkdown(lines.join('\n'));
}

// ============================================================================
// Relationships parsing (for hyperlinks)
// ============================================================================

interface Relationships {
  [rId: string]: string;
}

async function parseRelationships(zip: JSZip): Promise<Relationships> {
  const content = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (!content) {
    return {};
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'application/xml');
  const rels: Relationships = {};

  const relationships = doc.getElementsByTagName('Relationship');
  for (const rel of relationships) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    const targetMode = rel.getAttribute('TargetMode');

    // Only include external hyperlinks
    if (id && target && targetMode === 'External') {
      rels[id] = target;
    }
  }

  return rels;
}

// ============================================================================
// Numbering parsing (for lists)
// ============================================================================

interface NumberingInfo {
  // numId -> ilvl -> { isOrdered, start }
  definitions: Map<string, Map<string, { isOrdered: boolean; start: number }>>;
}

async function parseNumbering(zip: JSZip): Promise<NumberingInfo> {
  const content = await zip.file('word/numbering.xml')?.async('string');
  const info: NumberingInfo = { definitions: new Map() };

  if (!content) {
    return info;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'application/xml');

  // Parse abstract numbering definitions
  const abstractNums = new Map<string, Map<string, { isOrdered: boolean; start: number }>>();
  const abstractNumEls = doc.getElementsByTagName('w:abstractNum');

  for (const abstractNum of abstractNumEls) {
    const abstractNumId = abstractNum.getAttribute('w:abstractNumId');
    if (!abstractNumId) continue;

    const levels = new Map<string, { isOrdered: boolean; start: number }>();
    const lvlEls = abstractNum.getElementsByTagName('w:lvl');

    for (const lvl of lvlEls) {
      const ilvl = lvl.getAttribute('w:ilvl') || '0';
      const numFmtEl = lvl.getElementsByTagName('w:numFmt')[0];
      const startEl = lvl.getElementsByTagName('w:start')[0];

      const numFmt = numFmtEl?.getAttribute('w:val') || 'bullet';
      const start = parseInt(startEl?.getAttribute('w:val') || '1', 10);

      // Ordered formats: decimal, lowerLetter, upperLetter, lowerRoman, upperRoman
      const isOrdered = ['decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman'].includes(numFmt);

      levels.set(ilvl, { isOrdered, start });
    }

    abstractNums.set(abstractNumId, levels);
  }

  // Map numId to abstractNumId
  const numEls = doc.getElementsByTagName('w:num');
  for (const num of numEls) {
    const numId = num.getAttribute('w:numId');
    const abstractNumIdEl = num.getElementsByTagName('w:abstractNumId')[0];
    const abstractNumId = abstractNumIdEl?.getAttribute('w:val');

    if (numId && abstractNumId && abstractNums.has(abstractNumId)) {
      info.definitions.set(numId, abstractNums.get(abstractNumId)!);
    }
  }

  return info;
}

// ============================================================================
// Paragraph parsing
// ============================================================================

interface ListState {
  counters: Map<string, number[]>; // numId -> counter per level
}

function parseParagraph(
  p: Element,
  relationships: Relationships,
  numberingInfo: NumberingInfo,
  listState: ListState
): string {
  const pPr = p.getElementsByTagName('w:pPr')[0];

  // Check for heading style
  const pStyle = pPr?.getElementsByTagName('w:pStyle')[0];
  const styleVal = pStyle?.getAttribute('w:val') || '';

  // Detect heading level from style name
  const headingMatch = styleVal.match(/^Heading(\d+)$/i) || styleVal.match(/^heading\s*(\d+)$/i);
  const headingLevel = headingMatch ? parseInt(headingMatch[1], 10) : 0;

  // Check for list formatting
  const numPr = pPr?.getElementsByTagName('w:numPr')[0];
  let listPrefix = '';
  let listIndent = '';

  if (numPr) {
    const ilvlEl = numPr.getElementsByTagName('w:ilvl')[0];
    const numIdEl = numPr.getElementsByTagName('w:numId')[0];

    const ilvl = parseInt(ilvlEl?.getAttribute('w:val') || '0', 10);
    const numId = numIdEl?.getAttribute('w:val') || '';

    if (numId && numId !== '0') {
      const levelDefs = numberingInfo.definitions.get(numId);
      const levelDef = levelDefs?.get(String(ilvl));

      // Initialize counters for this list
      if (!listState.counters.has(numId)) {
        listState.counters.set(numId, []);
      }
      const counters = listState.counters.get(numId)!;

      // Ensure counter array is long enough
      while (counters.length <= ilvl) {
        counters.push(levelDef?.start || 1);
      }

      // Reset deeper levels when going to a shallower level
      for (let i = ilvl + 1; i < counters.length; i++) {
        counters[i] = levelDef?.start || 1;
      }

      listIndent = '  '.repeat(ilvl);

      if (levelDef?.isOrdered) {
        listPrefix = `${counters[ilvl]}. `;
        counters[ilvl]++;
      } else {
        listPrefix = '- ';
      }
    }
  } else {
    // Not a list paragraph, reset all list counters
    listState.counters.clear();
  }

  // Extract text content with inline formatting
  const textContent = extractTextContent(p, relationships);

  if (!textContent.trim()) {
    return '';
  }

  // Apply heading prefix
  if (headingLevel > 0 && headingLevel <= 6) {
    return '#'.repeat(headingLevel) + ' ' + textContent;
  }

  // Apply list formatting
  if (listPrefix) {
    return listIndent + listPrefix + textContent;
  }

  return textContent;
}

function extractTextContent(element: Element, relationships: Relationships): string {
  const parts: string[] = [];

  for (const child of element.children) {
    const tagName = child.tagName;

    if (tagName === 'w:r') {
      // Regular run
      parts.push(parseRun(child as Element));
    } else if (tagName === 'w:hyperlink') {
      // Hyperlink
      const rId = child.getAttribute('r:id');
      const url = rId ? relationships[rId] : null;
      const linkText = extractTextContent(child, relationships);

      if (url && linkText) {
        parts.push(`[${linkText}](${url})`);
      } else {
        parts.push(linkText);
      }
    } else if (tagName === 'w:bookmarkStart' || tagName === 'w:bookmarkEnd') {
      // Skip bookmarks
      continue;
    } else if (child.children.length > 0) {
      // Recursively process nested elements
      parts.push(extractTextContent(child, relationships));
    }
  }

  return parts.join('');
}

function parseRun(r: Element): string {
  const rPr = r.getElementsByTagName('w:rPr')[0];

  // Check formatting
  const isBold = rPr?.getElementsByTagName('w:b')[0] !== undefined ||
    rPr?.getElementsByTagName('w:bCs')[0] !== undefined;
  const isItalic = rPr?.getElementsByTagName('w:i')[0] !== undefined ||
    rPr?.getElementsByTagName('w:iCs')[0] !== undefined;
  const isStrike = rPr?.getElementsByTagName('w:strike')[0] !== undefined ||
    rPr?.getElementsByTagName('w:dstrike')[0] !== undefined;
  const isCode = isMonospaceFont(rPr);

  // Extract text from all <w:t> elements
  const textEls = r.getElementsByTagName('w:t');
  let text = '';
  for (const t of textEls) {
    text += t.textContent ?? '';
  }

  // Handle line breaks
  const brEls = r.getElementsByTagName('w:br');
  if (brEls.length > 0) {
    text += '\n';
  }

  // Handle tabs
  const tabEls = r.getElementsByTagName('w:tab');
  if (tabEls.length > 0) {
    text += '\t';
  }

  if (!text) {
    return '';
  }

  // Apply formatting (innermost to outermost)
  if (isCode) {
    text = '`' + text + '`';
  }
  if (isStrike) {
    text = '~~' + text + '~~';
  }
  if (isItalic) {
    text = '*' + text + '*';
  }
  if (isBold) {
    text = '**' + text + '**';
  }

  return text;
}

function isMonospaceFont(rPr: Element | undefined): boolean {
  if (!rPr) return false;

  const rFonts = rPr.getElementsByTagName('w:rFonts')[0];
  if (!rFonts) return false;

  const ascii = rFonts.getAttribute('w:ascii')?.toLowerCase() || '';
  const hAnsi = rFonts.getAttribute('w:hAnsi')?.toLowerCase() || '';

  const monospaceFonts = ['consolas', 'courier', 'courier new', 'monaco', 'menlo', 'source code pro', 'fira code', 'jetbrains mono'];

  return monospaceFonts.some(font => ascii.includes(font) || hAnsi.includes(font));
}

// ============================================================================
// Table parsing
// ============================================================================

function parseTable(tbl: Element, relationships: Relationships): string[] {
  const rows = tbl.getElementsByTagName('w:tr');
  const tableData: string[][] = [];

  for (const row of rows) {
    const cells = row.getElementsByTagName('w:tc');
    const rowData: string[] = [];

    for (const cell of cells) {
      // Extract text from all paragraphs in the cell
      const paragraphs = cell.getElementsByTagName('w:p');
      const cellTexts: string[] = [];

      for (const p of paragraphs) {
        const text = extractTextContent(p, relationships);
        if (text.trim()) {
          cellTexts.push(text.trim());
        }
      }

      // Join multiple paragraphs with <br> for GFM compatibility
      rowData.push(cellTexts.join('<br>'));
    }

    tableData.push(rowData);
  }

  if (tableData.length === 0) {
    return [];
  }

  // Determine column count (max cells in any row)
  const colCount = Math.max(...tableData.map(row => row.length));

  // Normalize rows to have same number of columns
  for (const row of tableData) {
    while (row.length < colCount) {
      row.push('');
    }
  }

  // Build markdown table
  const lines: string[] = [];

  // Header row (first row)
  const headerRow = tableData[0];
  lines.push('| ' + headerRow.map(cell => escapeTableCell(cell)).join(' | ') + ' |');

  // Separator row
  lines.push('| ' + headerRow.map(() => '---').join(' | ') + ' |');

  // Data rows
  for (let i = 1; i < tableData.length; i++) {
    const row = tableData[i];
    lines.push('| ' + row.map(cell => escapeTableCell(cell)).join(' | ') + ' |');
  }

  return lines;
}

function escapeTableCell(text: string): string {
  // Escape pipe characters in table cells
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

// ============================================================================
// Output cleanup
// ============================================================================

function cleanupMarkdown(markdown: string): string {
  // Collapse 3+ consecutive empty lines into 2
  let result = markdown.replace(/\n{3,}/g, '\n\n');

  // Remove trailing whitespace from each line
  result = result.split('\n').map(line => line.trimEnd()).join('\n');

  // Trim leading/trailing whitespace from entire document
  result = result.trim();

  // Fix adjacent formatting marks that should be merged
  // e.g., **text****more text** -> **text more text** (optional, can be complex)

  return result;
}
