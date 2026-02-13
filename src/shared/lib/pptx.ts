import JSZip from 'jszip';

/**
 * Converts a PPTX file to GitHub-flavored Markdown
 */
export async function pptxToMarkdown(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);

  // Get slide order from presentation.xml
  const slideOrder = await getSlideOrder(zip);

  if (slideOrder.length === 0) {
    throw new Error('Invalid PPTX: no slides found');
  }

  const slideMarkdowns: string[] = [];

  for (let i = 0; i < slideOrder.length; i++) {
    const slidePath = slideOrder[i];
    const slideNum = i + 1;

    // Parse slide relationships for hyperlinks
    const relsPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const relationships = await parseRelationships(zip, relsPath);

    // Parse slide content
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) continue;

    const slideMarkdown = parseSlide(slideXml, slideNum, relationships);

    // Parse speaker notes if available
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    const notesXml = await zip.file(notesPath)?.async('string');
    let notesMarkdown = '';
    if (notesXml) {
      const notesRelsPath = `ppt/notesSlides/_rels/notesSlide${slideNum}.xml.rels`;
      const notesRelationships = await parseRelationships(zip, notesRelsPath);
      notesMarkdown = parseNotes(notesXml, notesRelationships);
    }

    if (slideMarkdown.trim() || notesMarkdown.trim()) {
      let content = slideMarkdown;
      if (notesMarkdown.trim()) {
        content += '\n\n' + notesMarkdown;
      }
      slideMarkdowns.push(content);
    }
  }

  return slideMarkdowns.join('\n\n---\n\n');
}

// ============================================================================
// Slide order parsing
// ============================================================================

async function getSlideOrder(zip: JSZip): Promise<string[]> {
  // Parse presentation.xml.rels to map rId -> slide paths
  const relsContent = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (!relsContent) {
    return [];
  }

  const parser = new DOMParser();
  const relsDoc = parser.parseFromString(relsContent, 'application/xml');
  
  const rIdToPath = new Map<string, string>();
  const relationships = relsDoc.getElementsByTagName('Relationship');
  
  for (const rel of relationships) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    const type = rel.getAttribute('Type');
    
    if (id && target && type?.includes('/slide')) {
      // Normalize path
      const slidePath = target.startsWith('/') ? target.slice(1) : 'ppt/' + target;
      rIdToPath.set(id, slidePath);
    }
  }

  // Parse presentation.xml to get slide order
  const presContent = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presContent) {
    return [];
  }

  const presDoc = parser.parseFromString(presContent, 'application/xml');
  const sldIdList = presDoc.getElementsByTagName('p:sldId');
  
  const slides: string[] = [];
  for (const sldId of sldIdList) {
    const rId = sldId.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') 
      || sldId.getAttribute('r:id');
    if (rId && rIdToPath.has(rId)) {
      slides.push(rIdToPath.get(rId)!);
    }
  }

  return slides;
}

// ============================================================================
// Relationships parsing (for hyperlinks)
// ============================================================================

interface Relationships {
  [rId: string]: string;
}

async function parseRelationships(zip: JSZip, relsPath: string): Promise<Relationships> {
  const content = await zip.file(relsPath)?.async('string');
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
// Slide parsing
// ============================================================================

function parseSlide(xml: string, slideNum: number, relationships: Relationships): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  // Find the shape tree
  const spTree = doc.getElementsByTagName('p:spTree')[0];
  if (!spTree) {
    return `## Slide ${slideNum}`;
  }

  let title = '';
  const contentBlocks: string[] = [];

  // Process all shapes
  processShapeTree(spTree, relationships, (shapeInfo) => {
    if (shapeInfo.isTitle && shapeInfo.text.trim()) {
      title = shapeInfo.text.trim();
    } else if (shapeInfo.text.trim()) {
      contentBlocks.push(shapeInfo.text);
    } else if (shapeInfo.table) {
      contentBlocks.push(shapeInfo.table);
    }
  });

  // Build slide markdown
  const lines: string[] = [];
  
  if (title) {
    lines.push(`## Slide ${slideNum}: ${title}`);
  } else {
    lines.push(`## Slide ${slideNum}`);
  }

  if (contentBlocks.length > 0) {
    lines.push('');
    lines.push(contentBlocks.join('\n\n'));
  }

  return lines.join('\n');
}

interface ShapeInfo {
  isTitle: boolean;
  text: string;
  table?: string;
}

function processShapeTree(
  element: Element, 
  relationships: Relationships,
  callback: (info: ShapeInfo) => void
): void {
  for (const child of element.children) {
    const tagName = child.tagName;

    if (tagName === 'p:sp') {
      // Regular shape
      const shapeInfo = parseShape(child, relationships);
      callback(shapeInfo);
    } else if (tagName === 'p:grpSp') {
      // Grouped shapes - recurse
      processShapeTree(child, relationships, callback);
    } else if (tagName === 'p:graphicFrame') {
      // Could contain table
      const table = parseGraphicFrame(child, relationships);
      if (table) {
        callback({ isTitle: false, text: '', table });
      }
    }
  }
}

function parseShape(sp: Element, relationships: Relationships): ShapeInfo {
  // Check if this is a title shape
  const nvSpPr = sp.getElementsByTagName('p:nvSpPr')[0];
  const nvPr = nvSpPr?.getElementsByTagName('p:nvPr')[0];
  const ph = nvPr?.getElementsByTagName('p:ph')[0];
  const phType = ph?.getAttribute('type') || '';
  
  const cNvPr = nvSpPr?.getElementsByTagName('p:cNvPr')[0];
  const shapeName = cNvPr?.getAttribute('name')?.toLowerCase() || '';
  
  const isTitle = phType === 'title' || phType === 'ctrTitle' || 
    shapeName.includes('title');

  // Parse text body
  const txBody = sp.getElementsByTagName('p:txBody')[0];
  if (!txBody) {
    return { isTitle, text: '' };
  }

  const text = parseTextBody(txBody, relationships);
  return { isTitle, text };
}

function parseTextBody(txBody: Element, relationships: Relationships): string {
  const paragraphs: string[] = [];

  const pElements = txBody.getElementsByTagName('a:p');
  for (const p of pElements) {
    const paraText = parseParagraph(p, relationships);
    if (paraText !== null) {
      paragraphs.push(paraText);
    }
  }

  return paragraphs.join('\n');
}

function parseParagraph(p: Element, relationships: Relationships): string | null {
  const pPr = p.getElementsByTagName('a:pPr')[0];
  
  // Check for bullet/numbering
  let listPrefix = '';
  let indent = '';
  
  if (pPr) {
    const lvl = parseInt(pPr.getAttribute('lvl') || '0', 10);
    indent = '  '.repeat(lvl);
    
    const buChar = pPr.getElementsByTagName('a:buChar')[0];
    const buAutoNum = pPr.getElementsByTagName('a:buAutoNum')[0];
    const buNone = pPr.getElementsByTagName('a:buNone')[0];
    
    if (buAutoNum) {
      listPrefix = '1. ';
    } else if (buChar && !buNone) {
      listPrefix = '- ';
    } else if (!buNone && lvl > 0) {
      // Nested content often has implicit bullets
      listPrefix = '- ';
    }
  }

  // Extract text runs
  const textParts: string[] = [];
  
  for (const child of p.children) {
    if (child.tagName === 'a:r') {
      textParts.push(parseTextRun(child, relationships));
    } else if (child.tagName === 'a:br') {
      textParts.push('\n');
    }
  }

  const text = textParts.join('').trim();
  
  if (!text) {
    return null;
  }

  return indent + listPrefix + text;
}

function parseTextRun(r: Element, relationships: Relationships): string {
  const rPr = r.getElementsByTagName('a:rPr')[0];
  
  // Check formatting
  const isBold = rPr?.getAttribute('b') === '1';
  const isItalic = rPr?.getAttribute('i') === '1';
  const isStrike = rPr?.getAttribute('strike') === 'sngStrike' || 
    rPr?.getAttribute('strike') === 'dblStrike';
  
  // Check for hyperlink
  const hlinkClick = rPr?.getElementsByTagName('a:hlinkClick')[0];
  const linkRId = hlinkClick?.getAttributeNS(
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 
    'id'
  ) || hlinkClick?.getAttribute('r:id');
  const linkUrl = linkRId ? relationships[linkRId] : null;

  // Get text content
  const tEl = r.getElementsByTagName('a:t')[0];
  let text = tEl?.textContent ?? '';

  if (!text) {
    return '';
  }

  // Apply formatting (innermost to outermost)
  if (isStrike) {
    text = '~~' + text + '~~';
  }
  if (isItalic) {
    text = '*' + text + '*';
  }
  if (isBold) {
    text = '**' + text + '**';
  }
  if (linkUrl) {
    text = `[${text}](${linkUrl})`;
  }

  return text;
}

// ============================================================================
// Table parsing
// ============================================================================

function parseGraphicFrame(graphicFrame: Element, relationships: Relationships): string | null {
  const tbl = graphicFrame.getElementsByTagName('a:tbl')[0];
  if (!tbl) {
    return null;
  }

  const rows = tbl.getElementsByTagName('a:tr');
  const tableData: string[][] = [];

  for (const row of rows) {
    const cells = row.getElementsByTagName('a:tc');
    const rowData: string[] = [];

    for (const cell of cells) {
      const txBody = cell.getElementsByTagName('a:txBody')[0];
      let cellText = '';
      if (txBody) {
        cellText = parseTextBody(txBody, relationships)
          .replace(/\n/g, '<br>')
          .trim();
      }
      rowData.push(cellText);
    }

    tableData.push(rowData);
  }

  if (tableData.length === 0) {
    return null;
  }

  // Determine column count
  const colCount = Math.max(...tableData.map(row => row.length));

  // Normalize rows
  for (const row of tableData) {
    while (row.length < colCount) {
      row.push('');
    }
  }

  // Build markdown table
  const lines: string[] = [];

  // Header row
  const headerRow = tableData[0];
  lines.push('| ' + headerRow.map(cell => escapeTableCell(cell)).join(' | ') + ' |');

  // Separator
  lines.push('| ' + headerRow.map(() => '---').join(' | ') + ' |');

  // Data rows
  for (let i = 1; i < tableData.length; i++) {
    const row = tableData[i];
    lines.push('| ' + row.map(cell => escapeTableCell(cell)).join(' | ') + ' |');
  }

  return lines.join('\n');
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

// ============================================================================
// Speaker notes parsing
// ============================================================================

function parseNotes(xml: string, relationships: Relationships): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  // Find text bodies in the notes slide
  const txBodyElements = doc.getElementsByTagName('p:txBody');
  const notesTexts: string[] = [];

  for (const txBody of txBodyElements) {
    // Skip the slide number placeholder
    const parent = txBody.parentElement;
    const nvSpPr = parent?.getElementsByTagName('p:nvSpPr')[0];
    const ph = nvSpPr?.getElementsByTagName('p:ph')[0];
    const phType = ph?.getAttribute('type') || '';
    
    // Skip slide number and slide image placeholders
    if (phType === 'sldNum' || phType === 'sldImg') {
      continue;
    }

    const text = parseTextBody(txBody, relationships);
    if (text.trim()) {
      notesTexts.push(text.trim());
    }
  }

  if (notesTexts.length === 0) {
    return '';
  }

  // Format as blockquote
  const notesContent = notesTexts.join('\n\n');
  const quotedLines = notesContent.split('\n').map(line => '> ' + line);
  
  return '> **Notes:**\n>\n' + quotedLines.join('\n');
}
