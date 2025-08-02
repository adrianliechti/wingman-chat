// Artifact kind type
export type ArtifactKind = 'text' | 'code' | 'svg' | 'html' | 'csv' | 'mermaid';

// Helper function to get the language/extension from a file path
export function artifactLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return ext;
}

// Helper function to determine the kind of artifact based on file extension
export function artifactKind(filename: string): ArtifactKind {
  const ext = filename.split('.').pop()?.toLowerCase();
  
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
