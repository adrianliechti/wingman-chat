import { memo, useEffect, useMemo, useState } from "react";
import { sanitizeHtmlToReact } from "@/shared/lib/htmlToReact";
import { useTheme } from "@/shell/hooks/useTheme";
import { CopyButton } from "./CopyButton";

let shikiPromise: Promise<typeof import("shiki")> | null = null;
function getShiki() {
  if (!shikiPromise) shikiPromise = import("shiki");
  return shikiPromise;
}

const HIGHLIGHT_DEBOUNCE_MS = 120;
const MAX_HIGHLIGHT_CACHE_SIZE = 200;
const MAX_BLOCK_HIGHLIGHT_CACHE_SIZE = 200;
const highlightCache = new Map<string, string>();
const blockHighlightCache = new Map<string, string>();

function getCacheEntry(cache: Map<string, string>, key: string): string | undefined {
  const cached = cache.get(key);

  if (cached === undefined) {
    return undefined;
  }

  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

function setCacheEntry(cache: Map<string, string>, key: string, value: string, maxSize: number) {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);

  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value as string | undefined;

    if (oldestKey === undefined) {
      break;
    }

    cache.delete(oldestKey);
  }
}

const highlightedCodeStyle: React.CSSProperties = {
  margin: 0,
  padding: "1rem",
  fontSize: "0.875rem",
  lineHeight: "1.25rem",
  fontFamily: "Fira Code, Monaco, Cascadia Code, Roboto Mono, monospace",
  background: "transparent",
};

interface CodeRendererProps {
  code: string;
  language: string;
  name?: string;
  blockId?: string;
  isStreaming?: boolean;
}

const CodeRenderer = memo(({ code, language, name, blockId, isStreaming = false }: CodeRendererProps) => {
  const { isDark } = useTheme();
  const normalizedLanguage = language.toLowerCase();
  const cacheKey = `${isDark ? "dark" : "light"}:${normalizedLanguage}:${code}`;
  const blockCacheKey = blockId ? `${isDark ? "dark" : "light"}:${blockId}` : null;
  const [html, setHtml] = useState<string>(() => {
    return highlightCache.get(cacheKey) ?? (blockCacheKey ? (blockHighlightCache.get(blockCacheKey) ?? "") : "");
  });

  useEffect(() => {
    if (!blockCacheKey) {
      return;
    }

    return () => {
      blockHighlightCache.delete(blockCacheKey);
    };
  }, [blockCacheKey]);

  useEffect(() => {
    if (!code) {
      setHtml("");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cached = getCacheEntry(highlightCache, cacheKey);

    if (cached) {
      setHtml(cached);
      if (blockCacheKey) {
        setCacheEntry(blockHighlightCache, blockCacheKey, cached, MAX_BLOCK_HIGHLIGHT_CACHE_SIZE);
      }
      return;
    }

    if (blockCacheKey) {
      const previousBlockHtml = getCacheEntry(blockHighlightCache, blockCacheKey);
      if (previousBlockHtml) {
        setHtml(previousBlockHtml);
      }
    }

    const highlight = async () => {
      try {
        const { codeToHtml } = await getShiki();
        const highlighted = await codeToHtml(code, {
          lang: normalizedLanguage,
          theme: isDark ? "one-dark-pro" : "one-light",
          colorReplacements: {
            "#fafafa": "transparent",
            "#282c34": "transparent",
          },
        });

        setCacheEntry(highlightCache, cacheKey, highlighted, MAX_HIGHLIGHT_CACHE_SIZE);
        if (blockCacheKey) {
          setCacheEntry(blockHighlightCache, blockCacheKey, highlighted, MAX_BLOCK_HIGHLIGHT_CACHE_SIZE);
        }

        if (!cancelled) {
          setHtml(highlighted);
        }
      } catch (error) {
        console.error("Failed to highlight code:", error);
        if (!cancelled) {
          setHtml("");
        }
      }
    };

    timer = setTimeout(highlight, isStreaming ? HIGHLIGHT_DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [blockCacheKey, cacheKey, code, isDark, isStreaming, normalizedLanguage]);

  const effectiveHtml = code ? html : "";
  const renderedHtml = useMemo(
    () => sanitizeHtmlToReact(effectiveHtml, { keyPrefix: blockCacheKey ?? cacheKey }),
    [blockCacheKey, cacheKey, effectiveHtml],
  );

  const renderCodeBlock = (content: React.ReactNode) => (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>
          {language}
          {name && <span className="ml-2 text-gray-500 dark:text-neutral-400">• {name}</span>}
        </span>
        <div className="flex items-center space-x-2">
          <CopyButton text={code} className="h-4 w-4" />
        </div>
      </div>
      <div className="bg-white dark:bg-neutral-900 rounded-b-md overflow-hidden border-l border-r border-b border-gray-100 dark:border-neutral-800">
        {content}
      </div>
    </div>
  );

  if (!effectiveHtml) {
    return renderCodeBlock(
      <pre className="p-4 text-gray-800 dark:text-neutral-300 text-sm whitespace-pre overflow-x-auto">
        <code>{code}</code>
      </pre>,
    );
  }

  return renderCodeBlock(
    <div className="overflow-x-auto" style={highlightedCodeStyle}>
      {renderedHtml}
    </div>,
  );
});

CodeRenderer.displayName = "CodeRenderer";

export { CodeRenderer };
