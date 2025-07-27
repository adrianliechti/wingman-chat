import { memo, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { useTheme } from '../hooks/useTheme';

interface EditorProps {
  value: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string | undefined) => void;
  height?: string | number;
  width?: string | number;
  options?: import('monaco-editor').editor.IStandaloneEditorConstructionOptions;
}

// Language mapping for Monaco Editor
const getMonacoLanguage = (language: string): string => {
  const langMap: Record<string, string> = {
    // JavaScript/TypeScript family
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'javascript',
    'tsx': 'typescript',
    
    // Popular programming languages
    'py': 'python',
    'rb': 'ruby',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'kt': 'kotlin',
    'swift': 'swift',
    'dart': 'dart',
    'scala': 'scala',
    'clj': 'clojure',
    'ex': 'elixir',
    'lua': 'lua',
    'r': 'r',
    'jl': 'julia',
    
    // C family
    'c': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'cxx': 'cpp',
    'cs': 'csharp',
    'objc': 'objective-c',
    'm': 'objective-c',
    
    // Functional languages
    'fs': 'fsharp',
    'scm': 'scheme',
    'pas': 'pascal',
    
    // Web languages
    'php': 'php',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    
    // Shell scripting
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'fish': 'shell',
    'ps1': 'powershell',
    'bat': 'bat',
    
    // Database
    'sql': 'sql',
    'mysql': 'mysql',
    
    // Data formats
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'ini': 'ini',
    
    // Documentation
    'md': 'markdown',
    'markdown': 'markdown',
    'rst': 'restructuredtext',
    
    // Infrastructure/DevOps
    'dockerfile': 'dockerfile',
    'hcl': 'hcl',
    'tf': 'hcl',
    'bicep': 'bicep',
    
    // Specialized languages
    'sol': 'solidity',
    'pl': 'perl',
    'vb': 'vb',
    'liquid': 'liquid',
    'pug': 'pug',
    'wgsl': 'wgsl',
  };
  
  return langMap[language.toLowerCase()] || language.toLowerCase() || 'plaintext';
};

const Editor = memo(({ 
  value, 
  language, 
  readOnly = false, 
  onChange, 
  width = '100%',
  height = '100%',
  options = {},
  ...props 
}: EditorProps) => {
  const { isDark } = useTheme();
  const [editorWidth, setEditorWidth] = useState<number>(400);
  const [editorHeight, setEditorHeight] = useState<number>(200);

  const updateHeight = (editor: import('monaco-editor').editor.IStandaloneCodeEditor) => {
    const contentHeight = editor.getContentHeight();
    setEditorHeight(contentHeight);
  };

  const updateWidth = (editor: import('monaco-editor').editor.IStandaloneCodeEditor) => {
    const contentWidth = editor.getContentWidth();
    setEditorWidth(contentWidth);
  };

  const handleEditorDidMount = (editor: import('monaco-editor').editor.IStandaloneCodeEditor) => {
    // Auto-resize only when dimensions are explicitly set to "auto"
    const needsHeightUpdate = height === 'auto';
    const needsWidthUpdate = width === 'auto';
    
    if (needsHeightUpdate) {
      updateHeight(editor);
    }
    if (needsWidthUpdate) {
      updateWidth(editor);
    }
    
    if (needsHeightUpdate || needsWidthUpdate) {
      editor.onDidContentSizeChange(() => {
        if (needsHeightUpdate) updateHeight(editor);
        if (needsWidthUpdate) updateWidth(editor);
      });
    }
  };

  const handleEditorWillMount = (monaco: typeof import('monaco-editor')) => {
    // Define custom light theme matching app's neutral-50 background
    monaco.editor.defineTheme('wingman-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#fafafa', // neutral-50
        'editor.foreground': '#000000',
      }
    });

    // Define custom dark theme matching app's neutral-950 background  
    monaco.editor.defineTheme('wingman-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0a0a0a', // neutral-950
        'editor.foreground': '#ffffff',
      }
    });
  };

  const defaultOptions: import('monaco-editor').editor.IStandaloneEditorConstructionOptions = {
    readOnly,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    overviewRulerLanes: 0,
    fontSize: 14,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    padding: { top: 12, bottom: 12 },
    lineNumbers: 'on',
    folding: true,
    renderWhitespace: 'selection',
    wordWrap: 'off',
    scrollbar: {
      vertical: 'auto',
      horizontal: 'auto',
    },
  };

  const mergedOptions = { ...defaultOptions, ...options };

  const finalWidth = width === 'auto' ? `${editorWidth}px` : width;
  const finalHeight = height === 'auto' ? `${editorHeight}px` : height;

  return (
    <MonacoEditor
    width={finalWidth}
      height={finalHeight}
      language={getMonacoLanguage(language)}
      value={value}
      theme={isDark ? 'wingman-dark' : 'wingman-light'}
      beforeMount={handleEditorWillMount}
      onMount={handleEditorDidMount}
      onChange={onChange}
      options={mergedOptions}
      {...props}
    />
  );
});

Editor.displayName = 'Editor';

export { Editor };
