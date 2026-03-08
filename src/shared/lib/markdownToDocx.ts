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
import { marked } from "marked";
import type { Token, Tokens } from "marked";

type DocxElement = Paragraph | Table;

interface TextStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
}

function parseInlineTokens(tokens: Token[], style: TextStyle = {}): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        if (t.tokens?.length) {
          runs.push(...parseInlineTokens(t.tokens, style));
        } else {
          runs.push(new TextRun({ text: t.text, ...style }));
        }
        break;
      }
      case 'strong':
        runs.push(...parseInlineTokens((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case 'em':
        runs.push(...parseInlineTokens((token as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case 'del':
        runs.push(...parseInlineTokens((token as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case 'codespan':
        runs.push(new TextRun({ text: (token as Tokens.Codespan).text, font: "Courier New", shading: { fill: "f0f0f0" } }));
        break;
      case 'link': {
        const t = token as Tokens.Link;
        runs.push(new ExternalHyperlink({
          children: [new TextRun({ text: t.text, style: "Hyperlink" })],
          link: t.href,
        }));
        break;
      }
      case 'escape':
        runs.push(new TextRun({ text: (token as Tokens.Escape).text, ...style }));
        break;
      default:
        if ('raw' in token && typeof token.raw === 'string') {
          runs.push(new TextRun({ text: token.raw, ...style }));
        }
        break;
    }
  }

  return runs;
}

function getListItemInlineTokens(item: Tokens.ListItem): Token[] {
  const first = item.tokens[0];
  if (!first) return [];
  if ('tokens' in first && Array.isArray((first as Tokens.Text).tokens)) {
    return (first as Tokens.Text).tokens!;
  }
  return [];
}

function blockTokensToDocx(tokens: Token[]): DocxElement[] {
  const elements: DocxElement[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const t = token as Tokens.Heading;
        const headingLevels: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };
        elements.push(new Paragraph({
          children: parseInlineTokens(t.tokens),
          heading: headingLevels[t.depth] ?? HeadingLevel.HEADING_1,
        }));
        break;
      }
      case 'paragraph':
        elements.push(new Paragraph({
          children: parseInlineTokens((token as Tokens.Paragraph).tokens),
        }));
        break;
      case 'code': {
        const t = token as Tokens.Code;
        for (const line of t.text.split('\n')) {
          elements.push(new Paragraph({
            children: [new TextRun({ text: line || ' ', font: "Courier New", size: 20 })],
            shading: { fill: "f5f5f5" },
            spacing: { before: 0, after: 0 },
          }));
        }
        break;
      }
      case 'list': {
        const t = token as Tokens.List;
        t.items.forEach((item, index) => {
          const bullet = t.ordered ? `${index + 1}. ` : '• ';
          const prefix = item.task ? (item.checked ? '☑ ' : '☐ ') : '';
          elements.push(new Paragraph({
            children: [
              new TextRun({ text: bullet }),
              ...(prefix ? [new TextRun({ text: prefix })] : []),
              ...parseInlineTokens(getListItemInlineTokens(item)),
            ],
            indent: { left: 720 },
          }));
        });
        break;
      }
      case 'blockquote': {
        const t = token as Tokens.Blockquote;
        for (const bqToken of t.tokens) {
          if (bqToken.type === 'paragraph') {
            elements.push(new Paragraph({
              children: parseInlineTokens((bqToken as Tokens.Paragraph).tokens),
              indent: { left: 720 },
              border: { left: { style: BorderStyle.SINGLE, size: 24, color: "cccccc" } },
              shading: { fill: "f9f9f9" },
            }));
          }
        }
        break;
      }
      case 'table': {
        const t = token as Tokens.Table;
        const columnCount = t.header.length;
        const columnWidth = Math.floor(9638 / columnCount);
        const tableBorder = { style: BorderStyle.SINGLE, size: 8, color: "000000" };
        const borders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder };

        const getAlignment = (idx: number) => {
          const a = t.align[idx];
          if (a === 'center') return AlignmentType.CENTER;
          if (a === 'right') return AlignmentType.RIGHT;
          return AlignmentType.LEFT;
        };

        elements.push(new Table({
          rows: [
            new TableRow({
              tableHeader: true,
              children: t.header.map((cell, idx) =>
                new TableCell({
                  width: { size: columnWidth, type: WidthType.DXA },
                  children: [new Paragraph({
                    children: parseInlineTokens(cell.tokens, { bold: true }),
                    alignment: getAlignment(idx),
                  })],
                  shading: { fill: "E6E6E6" },
                  borders,
                })
              ),
            }),
            ...t.rows.map(row =>
              new TableRow({
                children: row.map((cell, idx) =>
                  new TableCell({
                    width: { size: columnWidth, type: WidthType.DXA },
                    children: [new Paragraph({
                      children: parseInlineTokens(cell.tokens),
                      alignment: getAlignment(idx),
                    })],
                    borders,
                  })
                ),
              })
            ),
          ],
          width: { size: 9638, type: WidthType.DXA },
          columnWidths: Array(columnCount).fill(columnWidth),
        }));
        elements.push(new Paragraph({ children: [] }));
        break;
      }
      case 'hr':
        elements.push(new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA" } },
          spacing: { before: 200, after: 200 },
        }));
        break;
    }
  }

  return elements;
}

export async function markdownToDocx(markdown: string): Promise<Blob> {
  const tokens = marked.lexer(markdown);
  const doc = new Document({
    sections: [{ children: blockTokensToDocx(tokens) }],
  });
  return Packer.toBlob(doc);
}
