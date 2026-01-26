import { useState, useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { useArtifacts } from '../hooks/useArtifacts';

interface JsEditorProps {
  content: string;
  onRunReady?: (handler: (() => Promise<void>) | null) => void;
  onRunningChange?: (isRunning: boolean) => void;
}

interface ConsoleEntry {
  type: 'log' | 'warn' | 'error' | 'table' | 'result';
  args: unknown[];
}

export function JsEditor({ content, onRunReady, onRunningChange }: JsEditorProps) {
  const { fs } = useArtifacts();
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<ConsoleEntry[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Notify parent of running state changes
  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setOutput([]);

    // Read files fresh from filesystem at execution time
    const files: Record<string, { content: string; contentType?: string }> = {};
    const fileList = await fs.listFiles();
    for (const file of fileList) {
      files[file.path] = { content: file.content, contentType: file.contentType };
    }

    // Build VFS object for injection - escape to prevent breaking script tag
    const vfsData = JSON.stringify(files).replace(/<\/script>/gi, '<\\/script>');

    // Escape user code to prevent breaking script tag
    const escapedContent = content.replace(/<\/script>/gi, '<\\/script>');

    // Wrap code in async IIFE to support top-level await
    const wrappedCode = `
(async () => {
  try {
    const __result = await (async () => {
      ${escapedContent}
    })();
    if (__result !== undefined) {
      window.__postResult(__result);
    }
  } catch (e) {
    console.error(e.stack || e.message || String(e));
  } finally {
    window.__done();
  }
})();
`;

    const html = `
<!DOCTYPE html>
<html>
<head></head>
<body>
  <script>
    // VFS setup
    const __vfsFiles = ${vfsData};
    
    window.vfs = {
      files: __vfsFiles,
      read: function(path) {
        const normalized = path.startsWith('/') ? path : '/' + path;
        const file = __vfsFiles[normalized] || __vfsFiles[path];
        return file ? file.content : null;
      },
      readJSON: function(path) {
        const content = this.read(path);
        return content ? JSON.parse(content) : null;
      },
      exists: function(path) {
        const normalized = path.startsWith('/') ? path : '/' + path;
        return !!(this.files[normalized] || this.files[path]);
      },
      list: function() {
        return Object.keys(this.files);
      }
    };

    // Fetch override for VFS
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      if (typeof input === 'string' && !input.startsWith('http://') && !input.startsWith('https://') && !input.startsWith('//')) {
        const content = vfs.read(input);
        if (content !== null) {
          const file = __vfsFiles[input.startsWith('/') ? input : '/' + input] || __vfsFiles[input];
          return new Response(content, {
            status: 200,
            headers: { 'Content-Type': file?.contentType || 'text/plain' }
          });
        }
      }
      return originalFetch.call(this, input, init);
    };

    // Console and result helpers
    const formatValue = (v) => {
      if (v === undefined) return 'undefined';
      if (v === null) return 'null';
      if (typeof v === 'function') return v.toString();
      if (typeof v === 'object') {
        try { return JSON.stringify(v, null, 2); } catch { return String(v); }
      }
      return String(v);
    };

    const sendConsole = (type, args) => {
      parent.postMessage({ type: 'console', method: type, args: args.map(formatValue) }, '*');
    };

    console.log = (...args) => sendConsole('log', args);
    console.warn = (...args) => sendConsole('warn', args);
    console.error = (...args) => sendConsole('error', args);
    console.info = (...args) => sendConsole('log', args);
    console.debug = (...args) => sendConsole('log', args);
    console.table = (data) => sendConsole('table', [data]);

    window.__postResult = (result) => {
      parent.postMessage({ type: 'result', value: formatValue(result) }, '*');
    };

    window.__done = () => {
      parent.postMessage({ type: 'done' }, '*');
    };

    window.onerror = (msg, url, line, col, error) => {
      console.error(error?.stack || msg);
      return true;
    };

    window.onunhandledrejection = (e) => {
      console.error('Unhandled Promise rejection:', e.reason?.stack || e.reason);
    };

    // Execute user code
    ${wrappedCode}
  </script>
</body>
</html>
`;

    const iframe = iframeRef.current;
    if (iframe) {
      const entries: ConsoleEntry[] = [];
      
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        
        const data = event.data;
        if (data.type === 'console') {
          entries.push({ type: data.method, args: data.args });
          setOutput([...entries]);
        } else if (data.type === 'result') {
          entries.push({ type: 'result', args: [data.value] });
          setOutput([...entries]);
        } else if (data.type === 'done') {
          setIsRunning(false);
          window.removeEventListener('message', handleMessage);
        }
      };

      window.addEventListener('message', handleMessage);

      const timeout = setTimeout(() => {
        setIsRunning(false);
        window.removeEventListener('message', handleMessage);
        entries.push({ type: 'error', args: ['Execution timed out (10s)'] });
        setOutput([...entries]);
      }, 10000);

      iframe.srcdoc = html;

      iframe.onload = () => {
        setTimeout(() => {
          clearTimeout(timeout);
        }, 100);
      };
    }
  }, [content, fs]);

  useEffect(() => {
    onRunReady?.(handleRun);
    return () => onRunReady?.(null);
  }, [handleRun, onRunReady]);

  const handleClear = useCallback(() => {
    setOutput([]);
  }, []);

  const hasOutput = output.length > 0;

  const renderEntry = (entry: ConsoleEntry, index: number) => {
    const colorClass = {
      log: 'text-neutral-600 dark:text-neutral-400',
      warn: 'text-amber-600 dark:text-amber-400',
      error: 'text-red-500/80 dark:text-red-400/70',
      table: 'text-neutral-600 dark:text-neutral-400',
      result: 'text-blue-600 dark:text-blue-400',
    }[entry.type];

    const prefix = entry.type === 'result' ? '← ' : '';

    if (entry.type === 'table' && entry.args[0]) {
      try {
        const data = typeof entry.args[0] === 'string' ? JSON.parse(entry.args[0]) : entry.args[0];
        if (Array.isArray(data) || typeof data === 'object') {
          return (
            <pre key={index} className={`${colorClass} whitespace-pre-wrap`}>
              {JSON.stringify(data, null, 2)}
            </pre>
          );
        }
      } catch {
        // Fall through to default rendering
      }
    }

    return (
      <pre key={index} className={`${colorClass} whitespace-pre-wrap`}>
        {prefix}{entry.args.join(' ')}
      </pre>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        className="hidden"
        title="JavaScript Sandbox"
      />

      <div className={hasOutput ? 'h-1/2 overflow-hidden' : 'flex-1 overflow-hidden'}>
        <CodeEditor content={content} language="javascript" />
      </div>

      {hasOutput && (
        <div className="h-1/2 flex flex-col border-t border-black/5 dark:border-white/5">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Console
            </span>
            <button
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-neutral-400 dark:text-neutral-500"
              title="Clear console"
            >
              <X size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 font-mono text-xs">
            {output.map((entry, index) => renderEntry(entry, index))}
          </div>
        </div>
      )}
    </div>
  );
}
