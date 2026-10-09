import type { BlockNode, InlineNode, ListItemNode, TableCellNode, TableNode } from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { MARKDOWN_PARSE_OPTIONS, markdownSyntaxExtensions, markdownUrlTransform } from "./markdownExtensions";

type DocxElement = Paragraph | Table;

interface TextStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
}

/** Plain text of an inline subtree, for alt text and component fallbacks. */
function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "inlineCode":
        case "inlineHtml":
          return node.value;
        case "image":
          return node.alt ?? "";
        case "break":
          return "\n";
        case "footnoteReference":
          return `[${node.number}]`;
        default:
          return "children" in node ? inlineText(node.children as InlineNode[]) : "";
      }
    })
    .join("");
}

function inlineRuns(nodes: InlineNode[], style: TextStyle = {}): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        runs.push(new TextRun({ text: node.value, ...style }));
        break;
      case "break":
        runs.push(new TextRun({ text: "", break: 1 }));
        break;
      case "strong":
        runs.push(...inlineRuns(node.children, { ...style, bold: true }));
        break;
      case "emphasis":
        runs.push(...inlineRuns(node.children, { ...style, italics: true }));
        break;
      case "strike":
        runs.push(...inlineRuns(node.children, { ...style, strike: true }));
        break;
      case "inlineCode":
        runs.push(new TextRun({ text: node.value, font: "Courier New", shading: { fill: "f0f0f0" } }));
        break;
      case "link":
        runs.push(
          new ExternalHyperlink({
            children: [new TextRun({ text: inlineText(node.children), style: "Hyperlink" })],
            link: node.href,
          }),
        );
        break;
      case "image":
        runs.push(new TextRun({ text: node.alt ?? "", ...style }));
        break;
      case "inlineHtml":
        runs.push(new TextRun({ text: node.value, ...style }));
        break;
      case "inlineComponent":
        // Math keeps its source; emoji spans keep their glyph.
        runs.push(new TextRun({ text: node.properties?.source ?? inlineText(node.children), ...style }));
        break;
      case "footnoteReference":
        runs.push(new TextRun({ text: `[${node.number}]`, ...style }));
        break;
      default:
        break;
    }
  }
  return runs;
}

/** The first paragraph of a list item, as the old converter rendered one line per item. */
function listItemInline(item: ListItemNode): InlineNode[] {
  const first = item.children[0];
  if (first?.type === "paragraph" || first?.type === "heading") return first.children;
  if (first?.type === "code") return [{ type: "text", value: first.value }];
  return [];
}

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function cellAlignment(align: TableNode["align"][number]) {
  if (align === "center") return AlignmentType.CENTER;
  if (align === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function blocksToDocx(blocks: BlockNode[]): DocxElement[] {
  const elements: DocxElement[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        elements.push(
          new Paragraph({
            children: inlineRuns(block.children),
            heading: HEADING_LEVELS[block.depth] ?? HeadingLevel.HEADING_1,
          }),
        );
        break;
      case "paragraph":
        elements.push(new Paragraph({ children: inlineRuns(block.children) }));
        break;
      case "code":
        for (const line of block.value.split("\n")) {
          elements.push(
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: "Courier New", size: 20 })],
              shading: { fill: "f5f5f5" },
              spacing: { before: 0, after: 0 },
            }),
          );
        }
        break;
      case "list":
        block.items.forEach((item, index) => {
          const bullet = block.ordered ? `${(block.start ?? 1) + index}. ` : "• ";
          const prefix = item.checked === undefined ? "" : item.checked ? "☑ " : "☐ ";
          elements.push(
            new Paragraph({
              children: [
                new TextRun({ text: bullet }),
                ...(prefix ? [new TextRun({ text: prefix })] : []),
                ...inlineRuns(listItemInline(item)),
              ],
              indent: { left: 720 },
            }),
          );
        });
        break;
      case "blockquote":
        for (const inner of block.children) {
          if (inner.type !== "paragraph") continue;
          elements.push(
            new Paragraph({
              children: inlineRuns(inner.children),
              indent: { left: 720 },
              border: { left: { style: BorderStyle.SINGLE, size: 24, color: "cccccc" } },
              shading: { fill: "f9f9f9" },
            }),
          );
        }
        break;
      case "table": {
        const columnCount = Math.max(1, block.header.length);
        const columnWidth = Math.floor(9638 / columnCount);
        const tableBorder = { style: BorderStyle.SINGLE, size: 8, color: "000000" };
        const borders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder };
        const cell = (content: TableCellNode, index: number, header: boolean) =>
          new TableCell({
            width: { size: columnWidth, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: inlineRuns(content.children, header ? { bold: true } : {}),
                alignment: cellAlignment(block.align[index]),
              }),
            ],
            ...(header ? { shading: { fill: "E6E6E6" } } : {}),
            borders,
          });
        elements.push(
          new Table({
            rows: [
              new TableRow({
                tableHeader: true,
                children: block.header.map((content, index) => cell(content, index, true)),
              }),
              ...block.rows.map(
                (row) => new TableRow({ children: row.map((content, index) => cell(content, index, false)) }),
              ),
            ],
            width: { size: 9638, type: WidthType.DXA },
            columnWidths: Array(columnCount).fill(columnWidth),
          }),
        );
        elements.push(new Paragraph({ children: [] }));
        break;
      }
      case "thematicBreak":
        elements.push(
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA" } },
            spacing: { before: 200, after: 200 },
          }),
        );
        break;
      case "component":
      case "callout":
        elements.push(...blocksToDocx(block.children));
        break;
      case "footnotes":
        for (const item of block.items) {
          elements.push(new Paragraph({ children: [new TextRun({ text: `[${item.number}]` })] }));
          elements.push(...blocksToDocx(item.children));
        }
        break;
      default:
        break;
    }
  }

  return elements;
}

export async function markdownToDocx(markdown: string): Promise<Blob> {
  const document = parseMarkdown(markdown, {
    ...MARKDOWN_PARSE_OPTIONS,
    extensions: markdownSyntaxExtensions,
    urlTransform: markdownUrlTransform,
  });
  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial" } } } },
    sections: [{ children: blocksToDocx(document.children) }],
  });
  return Packer.toBlob(doc);
}
