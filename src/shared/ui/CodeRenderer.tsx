import { memo, useEffect, useMemo, useState } from "react";
import { sanitizeHtmlToReact } from "@/shared/lib/htmlToReact";
import { useTheme } from "@/shell/hooks/useTheme";
import { CopyButton } from "./CopyButton";
import { RendererFrame } from "./renderers/RendererFrame";

const HIGHLIGHT_DEBOUNCE_MS = 120;
const MAX_HIGHLIGHT_CACHE_SIZE = 200;
const highlightCache = new Map<string, string>();

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
  padding: "0.75rem",
  fontSize: "0.875rem",
  lineHeight: "1.25rem",
  fontFamily: "Fira Code, Monaco, Cascadia Code, Roboto Mono, monospace",
  background: "transparent",
};

interface CodeRendererProps {
  code: string;
  language: string;
  name?: string;
  isStreaming?: boolean;
  /** Strip the header bar and borders for inline contexts (e.g. tool details). */
  subtle?: boolean;
}

const CodeRenderer = memo(({ code, language, name, isStreaming = false, subtle = false }: CodeRendererProps) => {
  const { isDark } = useTheme();
  const normalizedLanguage = language.toLowerCase();
  const cacheKey = `${isDark ? "dark" : "light"}:${normalizedLanguage}:${code}`;
  const [highlighted, setHighlighted] = useState(() => ({ key: cacheKey, html: highlightCache.get(cacheKey) ?? "" }));

  useEffect(() => {
    if (!code) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cached = getCacheEntry(highlightCache, cacheKey);

    if (cached) {
      setHighlighted({ key: cacheKey, html: cached });
      return;
    }

    const highlight = async () => {
      try {
        const { codeToHtml } = await import("shiki");
        if (cancelled) return;
        const highlighted = await codeToHtml(code, {
          lang: normalizedLanguage,
          theme: isDark ? "one-dark-pro" : "one-light",
          colorReplacements: {
            "#fafafa": "transparent",
            "#282c34": "transparent",
          },
        });

        if (!cancelled) {
          // Retain completed blocks, not hundreds of growing stream prefixes.
          if (!isStreaming) setCacheEntry(highlightCache, cacheKey, highlighted, MAX_HIGHLIGHT_CACHE_SIZE);
          setHighlighted({ key: cacheKey, html: highlighted });
        }
      } catch (error) {
        console.error("Failed to highlight code:", error);
        if (!cancelled) {
          setHighlighted({ key: cacheKey, html: "" });
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
  }, [cacheKey, code, isDark, isStreaming, normalizedLanguage]);

  // Never show an older snapshot while the new source waits for highlighting.
  const effectiveHtml = code && highlighted.key === cacheKey ? highlighted.html : "";
  const renderedHtml = useMemo(() => sanitizeHtmlToReact(effectiveHtml), [effectiveHtml]);

  // Tool details (subtle) show just the name (Result/Error); everywhere else
  // keeps the language hint as the tag, with an optional name (e.g. a filename).
  const renderCodeBlock = (content: React.ReactNode) => (
    <RendererFrame
      label={subtle ? (name ?? "") : language}
      name={subtle ? undefined : name}
      actions={<CopyButton text={code} label="Copy" />}
    >
      {content}
    </RendererFrame>
  );

  if (!effectiveHtml) {
    return renderCodeBlock(
      <pre className="p-3 text-gray-800 dark:text-neutral-300 text-sm whitespace-pre overflow-x-auto">
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
