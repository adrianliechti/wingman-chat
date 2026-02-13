import { docxToMarkdown } from '@/shared/lib/docx';
import { pptxToMarkdown } from '@/shared/lib/pptx';
import { xlsxToCsv } from '@/shared/lib/xlsx';

// Artifact kind type
export type ArtifactKind = 'text' | 'code' | 'svg' | 'html' | 'csv' | 'mermaid' | 'markdown';

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

  // Default: read as text
  const content = await file.text();
  return [{
    path: `/${file.name}`,
    content,
    contentType: file.type || 'text/plain'
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

// Helper function to determine the kind of artifact based on file extension
export function artifactKind(path: string): ArtifactKind {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const basename = path.split('/').pop()?.toLowerCase() || '';
  
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
  
  // Default to text for everything else
  return 'text';
}
