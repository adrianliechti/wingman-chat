import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ExternalHyperlink,
} from "docx";

type DocxElement = Paragraph | Table;

interface Token {
  type: string;
  raw: string;
  text?: string;
  depth?: number;
  tokens?: Token[];
  items?: Token[];
  ordered?: boolean;
  header?: Token[];
  rows?: Token[][];
  align?: (string | null)[];
  href?: string;
  lang?: string;
  task?: boolean;
  checked?: boolean;
}

// Simple markdown tokenizer
function tokenize(markdown: string): Token[] {
  const tokens: Token[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: 'code', raw: codeLines.join('\n'), text: codeLines.join('\n'), lang });
      i++;
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].includes('-')) {
      const headerCells = line.split('|').map(c => c.trim()).filter(c => c);
      const alignLine = lines[i + 1];
      const alignCells = alignLine.split('|').map(c => c.trim()).filter(c => c);
      const align = alignCells.map(cell => {
        if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
        if (cell.endsWith(':')) return 'right';
        return 'left';
      });
      
      const header = headerCells.map(text => ({ type: 'text', raw: text, text }));
      const rows: Token[][] = [];
      
      i += 2;
      while (i < lines.length && lines[i].includes('|')) {
        const rowCells = lines[i].split('|').map(c => c.trim()).filter(c => c);
        rows.push(rowCells.map(text => ({ type: 'text', raw: text, text })));
        i++;
      }
      
      tokens.push({ type: 'table', raw: line, header, rows, align });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const text = headingMatch[2];
      tokens.push({ type: 'heading', raw: line, text, depth });
      i++;
      continue;
    }

    // Unordered list
    if (line.match(/^[\s]*[-*+]\s+/)) {
      const items: Token[] = [];
      while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s+/)) {
        const match = lines[i].match(/^[\s]*[-*+]\s+\[([xX ])\]\s*(.+)$/) || 
                      lines[i].match(/^[\s]*[-*+]\s+(.+)$/);
        if (match) {
          if (match.length === 3) {
            // Task list item
            items.push({ type: 'list_item', raw: lines[i], text: match[2], task: true, checked: match[1].toLowerCase() === 'x' });
          } else {
            items.push({ type: 'list_item', raw: lines[i], text: match[1] });
          }
        }
        i++;
      }
      tokens.push({ type: 'list', raw: '', items, ordered: false });
      continue;
    }

    // Ordered list
    if (line.match(/^[\s]*\d+[.)]\s+/)) {
      const items: Token[] = [];
      while (i < lines.length && lines[i].match(/^[\s]*\d+[.)]\s+/)) {
        const match = lines[i].match(/^[\s]*\d+[.)]\s+(.+)$/);
        if (match) {
          items.push({ type: 'list_item', raw: lines[i], text: match[1] });
        }
        i++;
      }
      tokens.push({ type: 'list', raw: '', items, ordered: true });
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      tokens.push({ type: 'blockquote', raw: quoteLines.join('\n'), text: quoteLines.join('\n') });
      continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}$/)) {
      tokens.push({ type: 'hr', raw: line });
      i++;
      continue;
    }

    // Paragraph
    tokens.push({ type: 'paragraph', raw: line, text: line });
    i++;
  }

  return tokens;
}

// Parse inline formatting and return TextRun array
function parseInline(text: string): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      runs.push(
        new ExternalHyperlink({
          children: [new TextRun({ text: linkMatch[1], style: "Hyperlink" })],
          link: linkMatch[2],
        })
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      runs.push(new TextRun({ text: codeMatch[1], font: "Courier New", shading: { fill: "f0f0f0" } }));
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold + Italic: ***text*** or ___text___
    const boldItalicMatch = remaining.match(/^(\*\*\*|___)(.+?)\1/);
    if (boldItalicMatch) {
      runs.push(new TextRun({ text: boldItalicMatch[2], bold: true, italics: true }));
      remaining = remaining.slice(boldItalicMatch[0].length);
      continue;
    }

    // Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
    if (boldMatch) {
      runs.push(new TextRun({ text: boldMatch[2], bold: true }));
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)(.+?)\1/);
    if (italicMatch) {
      runs.push(new TextRun({ text: italicMatch[2], italics: true }));
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~(.+?)~~/);
    if (strikeMatch) {
      runs.push(new TextRun({ text: strikeMatch[1], strike: true }));
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Plain text until next special character
    const plainMatch = remaining.match(/^[^*_`~[]+/);
    if (plainMatch) {
      runs.push(new TextRun({ text: plainMatch[0] }));
      remaining = remaining.slice(plainMatch[0].length);
      continue;
    }

    // Single special character (not part of formatting)
    runs.push(new TextRun({ text: remaining[0] }));
    remaining = remaining.slice(1);
  }

  return runs;
}

// Convert tokens to docx elements
function tokensToDocx(tokens: Token[]): DocxElement[] {
  const elements: DocxElement[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const headingLevels: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };
        elements.push(
          new Paragraph({
            children: parseInline(token.text || ''),
            heading: headingLevels[token.depth || 1],
          })
        );
        break;
      }

      case 'paragraph': {
        elements.push(
          new Paragraph({
            children: parseInline(token.text || ''),
          })
        );
        break;
      }

      case 'code': {
        const codeLines = (token.text || '').split('\n');
        for (const codeLine of codeLines) {
          elements.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: codeLine || ' ',
                  font: "Courier New",
                  size: 20,
                }),
              ],
              shading: { fill: "f5f5f5" },
              spacing: { before: 0, after: 0 },
            })
          );
        }
        break;
      }

      case 'list': {
        const items = token.items || [];
        items.forEach((item, index) => {
          const bullet = token.ordered ? `${index + 1}. ` : '• ';
          const prefix = item.task ? (item.checked ? '☑ ' : '☐ ') : '';
          elements.push(
            new Paragraph({
              children: [
                new TextRun({ text: bullet }),
                ...(prefix ? [new TextRun({ text: prefix })] : []),
                ...parseInline(item.text || ''),
              ],
              indent: { left: 720 },
            })
          );
        });
        break;
      }

      case 'blockquote': {
        elements.push(
          new Paragraph({
            children: parseInline(token.text || ''),
            indent: { left: 720 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 24, color: "cccccc" },
            },
            shading: { fill: "f9f9f9" },
          })
        );
        break;
      }

      case 'table': {
        const headerCells = token.header || [];
        const rows = token.rows || [];
        const align = token.align || [];
        const columnCount = headerCells.length || 1;
        // Calculate equal column width (in twips, ~9638 twips = 100% page width)
        const columnWidth = Math.floor(9638 / columnCount);

        const getAlignment = (idx: number) => {
          const a = align[idx];
          if (a === 'center') return AlignmentType.CENTER;
          if (a === 'right') return AlignmentType.RIGHT;
          return AlignmentType.LEFT;
        };

        const tableBorder = {
          style: BorderStyle.SINGLE,
          size: 8,
          color: "000000",
        };

        const tableRows = [
          new TableRow({
            tableHeader: true,
            children: headerCells.map((cell, idx) =>
              new TableCell({
                width: { size: columnWidth, type: WidthType.DXA },
                children: [new Paragraph({ 
                  children: [new TextRun({ text: cell.text || '', bold: true })],
                  alignment: getAlignment(idx),
                })],
                shading: { fill: "E6E6E6" },
                borders: {
                  top: tableBorder,
                  bottom: tableBorder,
                  left: tableBorder,
                  right: tableBorder,
                },
              })
            ),
          }),
          ...rows.map(
            (row) =>
              new TableRow({
                children: row.map((cell, idx) =>
                  new TableCell({
                    width: { size: columnWidth, type: WidthType.DXA },
                    children: [new Paragraph({ 
                      children: parseInline(cell.text || ''),
                      alignment: getAlignment(idx),
                    })],
                    borders: {
                      top: tableBorder,
                      bottom: tableBorder,
                      left: tableBorder,
                      right: tableBorder,
                    },
                  })
                ),
              })
          ),
        ];

        elements.push(
          new Table({
            rows: tableRows,
            width: { size: 9638, type: WidthType.DXA },
            columnWidths: Array(columnCount).fill(columnWidth),
          })
        );
        // Add spacing after table
        elements.push(new Paragraph({ children: [] }));
        break;
      }

      case 'hr': {
        elements.push(
          new Paragraph({
            children: [],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA" },
            },
            spacing: { before: 200, after: 200 },
          })
        );
        break;
      }
    }
  }

  return elements;
}

export async function markdownToDocx(markdown: string): Promise<Blob> {
  const tokens = tokenize(markdown);
  const elements = tokensToDocx(tokens);

  const doc = new Document({
    sections: [
      {
        children: elements,
      },
    ],
  });

  const buffer = await Packer.toBlob(doc);
  return buffer;
}
