import { docxToMarkdown } from "./docx";
import { pptxToMarkdown } from "./pptx";
import { xlsxToCsv } from "./xlsx";
import { isTextContentType } from "./fileTypes";

/**
 * Extracts text content from a file using the same converters as the artifacts module.
 *
 * - XLSX → CSV (multiple sheets joined with headers)
 * - DOCX → Markdown
 * - PPTX → Markdown
 * - PDF / email (.msg, .eml) → Markdown via backend extractor
 * - Text files → raw text
 *
 * @param file         The File to convert
 * @param extractText  Backend extractor for PDF / email (client.extractText)
 * @returns            The extracted text content
 */
export async function convertFileToText(file: File, extractText?: (file: File) => Promise<string>): Promise<string> {
  const name = file.name.toLowerCase();

  // XLSX → CSV
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const results = await xlsxToCsv(file);
    if (results.length === 1) return results[0].csv;
    return results.map((r) => `## ${r.sheetName}\n\n${r.csv}`).join("\n\n");
  }

  // DOCX → Markdown
  if (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return docxToMarkdown(file);
  }

  // PPTX → Markdown
  if (
    name.endsWith(".pptx") ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return pptxToMarkdown(file);
  }

  // PDF → backend extraction
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    if (!extractText) throw new Error("PDF extraction requires a backend extractor");
    return extractText(file);
  }

  // Email → backend extraction
  if (name.endsWith(".msg") || name.endsWith(".eml")) {
    if (!extractText) throw new Error("Email extraction requires a backend extractor");
    return extractText(file);
  }

  // Text files → read directly
  const contentType = file.type || "text/plain";
  if (isTextContentType(contentType)) {
    return file.text();
  }

  // Fallback: try reading as text
  return file.text();
}
