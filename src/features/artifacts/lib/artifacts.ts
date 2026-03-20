import { getConfig } from '@/shared/config';
import { docxToMarkdown } from '@/shared/lib/docx';
import { isTextContentType } from '@/shared/lib/fileTypes';
import { pptxToMarkdown } from '@/shared/lib/pptx';
import { readAsDataURL } from '@/shared/lib/utils';
import { xlsxToCsv } from '@/shared/lib/xlsx';

// Artifact kind type
export type ArtifactKind = 'text' | 'code' | 'svg' | 'html' | 'csv' | 'mermaid' | 'markdown' | 'image' | 'binary';

// Re-export HTML transformation utilities
export { transformHtmlForPreview, type TransformResult } from './artifactsHtml';

// Result type for processed files
export interface ProcessedFile {
  path: string;
  content: string;
  contentType: string;
}

// Process an uploaded file, converting XLSX to CSV and DOCX to Markdown when detected
export async function processUploadedFile(file: File): Promise<ProcessedFile[]> {
  const fileName = file.name.toLowerCase();

  // Handle XLSX files -> convert to CSV
  const isXlsx = fileName.endsWith('.xlsx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (isXlsx) {
    try {
      const results = await xlsxToCsv(file);
      const baseName = file.name.replace(/\.xlsx$/i, '');

      return results.map((result) => {
        // For single sheet, use simple filename; for multiple sheets, include sheet name
        const csvPath = results.length === 1
          ? `/${baseName}.csv`
          : `/${baseName}_${result.sheetName}.csv`;

        return {
          path: csvPath,
          content: result.csv,
          contentType: 'text/csv'
        };
      });
    } catch (error) {
      console.error(`Error converting XLSX file ${file.name}:`, error);
      // Fall through to default text handling on error
    }
  }

  // Handle DOCX files -> extract to Markdown
  const isDocx = fileName.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  if (isDocx) {
    try {
      const markdown = await docxToMarkdown(file);
      const baseName = file.name.replace(/\.docx$/i, '');

      return [{
        path: `/${baseName}.md`,
        content: markdown,
        contentType: 'text/markdown'
      }];
    } catch (error) {
      console.error(`Error converting DOCX file ${file.name}:`, error);
      // Fall through to default text handling on error
    }
  }

  // Handle PPTX files -> extract to Markdown
  const isPptx = fileName.endsWith('.pptx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  if (isPptx) {
    try {
      const markdown = await pptxToMarkdown(file);
      const baseName = file.name.replace(/\.pptx$/i, '');

      return [{
        path: `/${baseName}.md`,
        content: markdown,
        contentType: 'text/markdown'
      }];
    } catch (error) {
      console.error(`Error converting PPTX file ${file.name}:`, error);
      // Fall through to default text handling on error
    }
  }

  // Handle PDF files -> extract to Markdown via backend API
  const isPdf = fileName.endsWith('.pdf') || file.type === 'application/pdf';

  if (isPdf) {
    try {
      const markdown = await getConfig().client.extractText(file);
      const baseName = file.name.replace(/\.pdf$/i, '');

      return [{
        path: `/${baseName}.md`,
        content: markdown,
        contentType: 'text/markdown'
      }];
    } catch (error) {
      console.error(`Error extracting PDF file ${file.name}:`, error);
      // Fall through to default handling on error
    }
  }

  // Handle email files (.msg, .eml) -> extract to Markdown via backend API
  const isEmail = fileName.endsWith('.msg') || fileName.endsWith('.eml');

  if (isEmail) {
    try {
      const markdown = await getConfig().client.extractText(file);
      const baseName = file.name.replace(/\.(msg|eml)$/i, '');

      return [{
        path: `/${baseName}.md`,
        content: markdown,
        contentType: 'text/markdown'
      }];
    } catch (error) {
      console.error(`Error extracting email file ${file.name}:`, error);
      // Fall through to default handling on error
    }
  }

  const contentType = file.type || 'text/plain';
  const content = isTextContentType(contentType)
    ? await file.text()
    : await readAsDataURL(file);

  return [{
    path: `/${file.name}`,
    content,
    contentType,
  }];
}

// Helper function to get the language/extension from a file path
export function artifactLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const basename = path.split('/').pop()?.toLowerCase() || '';
  
  // Handle Dockerfile files
  if (basename === 'dockerfile' || basename.startsWith('dockerfile.')) {
    return 'dockerfile';
  }
  
  // Handle Makefile files
  if (basename === 'makefile' || basename.startsWith('makefile.')) {
    return 'makefile';
  }
  
  return ext;
}

// Helper function to determine the kind of artifact based on file extension and content type.
export function artifactKind(path: string, contentType?: string): ArtifactKind {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const basename = path.split('/').pop()?.toLowerCase() || '';
  const normalizedContentType = contentType?.toLowerCase();

  if (normalizedContentType === 'image/svg+xml') {
    return 'svg';
  }

  if (normalizedContentType === 'text/html') {
    return 'html';
  }

  if (normalizedContentType === 'text/csv' || normalizedContentType === 'text/tab-separated-values') {
    return 'csv';
  }

  if (normalizedContentType === 'text/markdown') {
    return 'markdown';
  }

  if (normalizedContentType === 'text/vnd.mermaid') {
    return 'mermaid';
  }
  
  // Dockerfile files (check for exact names)
  if (basename === 'dockerfile' || basename.startsWith('dockerfile.')) {
    return 'code';
  }
  
  // Makefile files (check for exact names)
  if (basename === 'makefile' || basename.startsWith('makefile.')) {
    return 'code';
  }
  
  // HTML files
  if (ext === 'html' || ext === 'htm') {
    return 'html';
  }
  
  // SVG files
  if (ext === 'svg') {
    return 'svg';
  }
  
  // CSV files
  if (ext === 'csv' || ext === 'tsv') {
    return 'csv';
  }
  
  // Mermaid files
  if (ext === 'mmd' || ext === 'mermaid') {
    return 'mermaid';
  }
  
  // Markdown files
  if (ext === 'md' || ext === 'markdown') {
    return 'markdown';
  }

  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tif', 'tiff'];

  if (normalizedContentType?.startsWith('image/') || imageExtensions.includes(ext)) {
    return 'image';
  }
  
  // Code files
  const codeExtensions = [
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'jar',
    'c', 'cc', 'cpp', 'cxx', 'h', 'hpp', 'hxx', 'hh', 'cs', 'php', 'rb',
    'swift', 'kt', 'kts', 'scala', 'sc', 'dart', 'm', 'mm', 'sh', 'bash',
    'zsh', 'ksh', 'pl', 'pm', 't', 'r', 'jl', 'lua', 'hs', 'ex', 'exs',
    'erl', 'hrl', 'fs', 'fsi', 'fsx', 'fsscript', 'vb', 'vbs', 'asm', 's',
    'S', 'sql', 'd.ts', 'groovy', 'gradle', 'coffee', 'nim', 'clj', 'cljs',
    'edn', 'lisp', 'scm', 'rkt', 'ml', 'mli', 'ada', 'adb', 'ads', 'pas',
    'pp', 'f', 'f90', 'f95', 'for', 'v', 'vh', 'sv', 'vhd', 'vhdl',
    'css', 'scss', 'sass', 'less', 'styl', 'json', 'jsonc', 'json5', 
    'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'xml'
  ];
  
  if (codeExtensions.includes(ext || '')) {
    return 'code';
  }

  const binaryExtensions = [
    'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
    'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
    'mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv',
    'bin', 'wasm', 'pyc', 'pkl', 'pickle', 'sqlite', 'db', 'ico'
  ];

  if ((normalizedContentType && !isTextContentType(normalizedContentType)) || binaryExtensions.includes(ext)) {
    return 'binary';
  }
  
  // Default to text for everything else
  return 'text';
}
