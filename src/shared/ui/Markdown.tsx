import type { Components } from "hast-util-to-jsx-runtime";
import katex from "katex";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeKatex from "rehype-katex";
import rehypeReact from "rehype-react";
import remarkBreaks from "remark-breaks";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import "katex/dist/katex.min.css";
import type { ReactNode } from "react";
import rehypeNotoEmoji from "@/shared/lib/rehype-noto-emoji";
import { isAudioUrl, isVideoUrl } from "@/shared/lib/utils";
import { CodeRenderer } from "./CodeRenderer";
import { MediaPlayer } from "./MediaPlayer";
import { CsvRenderer } from "./renderers/CsvRenderer";
import { HtmlRenderer } from "./renderers/HtmlRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { SvgRenderer } from "./renderers/SvgRenderer";

const markdownLinkClassName =
  "text-sky-700 dark:text-sky-300 underline decoration-2 underline-offset-3 decoration-sky-500/60 dark:decoration-sky-400/70 hover:text-sky-800 dark:hover:text-sky-200 hover:decoration-current focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50";

const slugify = (children: ReactNode): string => {
  const text = extractText(children);
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const getInternalHash = (url: string): string | null => {
  if (!url) return null;
  if (url.startsWith("#")) return decodeURIComponent(url.slice(1));
  if (typeof window === "undefined") return null;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin && parsed.pathname === window.location.pathname && parsed.hash) {
      return decodeURIComponent(parsed.hash.slice(1));
    }
  } catch {
    /* ignore */
  }
  return null;
};

const extractText = (node: ReactNode): string => {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
};

function LatexRenderer({ code, filename }: { code: string; filename?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    try {
      katex.render(code, container, {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
        errorColor: "transparent",
        trust: true,
        fleqn: false,
      });
      setFailed(false);
    } catch (error) {
      console.warn("KaTeX rendering failed:", error);
      setFailed(true);
    }
  }, [code]);

  if (failed) {
    return <CodeRenderer code={code} language="latex" name={filename} />;
  }

  return (
    <div className="my-4">
      {filename && <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 font-mono">{filename}</div>}
      <div ref={containerRef} className="overflow-x-auto" />
    </div>
  );
}

function createComponents(scopeId: string, isStreaming: boolean): Partial<Components> {
  let blockIndex = 0;

  return {
    pre: ({ children }) => {
      return <>{children}</>;
    },
    input: ({ type, checked, className, ...props }) => {
      if (type === "checkbox") {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            disabled
            className={`${className ?? ""} task-checkbox${checked ? " checked" : ""}`.trim()}
            {...props}
          />
        );
      }
      return <input type={type} checked={checked} className={className} {...props} />;
    },
    li: ({ children, className, ...props }) => {
      const isTask = typeof className === "string" && className.includes("task-list-item");
      return (
        <li className={`py-1 ml-0 ${isTask ? "task-list-item" : ""}`} {...props}>
          {children}
        </li>
      );
    },
    ul: ({ children, className, ...props }) => {
      const isTaskList = typeof className === "string" && className.includes("contains-task-list");
      return (
        <ul className={isTaskList ? "task-list ml-0 pl-0" : "custom-list ml-5 pl-0"} {...props}>
          {children}
        </ul>
      );
    },
    ol: ({ children, ...props }) => {
      return (
        <ol className="list-decimal list-inside ml-6 pl-0" {...props}>
          {children}
        </ol>
      );
    },
    strong: ({ children, ...props }) => {
      return (
        <span className="font-semibold" {...props}>
          {children}
        </span>
      );
    },
    a: ({ children, href, ...props }) => {
      let url = href || "";
      const internalHash = getInternalHash(url);

      if (url && !url.startsWith("http") && !url.startsWith("#")) {
        url = `https://${url}`;
      }

      if (isAudioUrl(url)) {
        return (
          <MediaPlayer url={url} type="audio">
            {children}
          </MediaPlayer>
        );
      }

      if (isVideoUrl(url)) {
        return (
          <MediaPlayer url={url} type="video">
            {children}
          </MediaPlayer>
        );
      }

      if (internalHash) {
        return (
          <a
            className={markdownLinkClassName}
            href={`#${internalHash}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(internalHash)?.scrollIntoView({ behavior: "smooth" });
            }}
            {...props}
          >
            {children}
          </a>
        );
      }

      return (
        <a className={markdownLinkClassName} href={url} target="_blank" rel="noreferrer noopener" {...props}>
          {children}
        </a>
      );
    },
    h1: ({ children, ...props }) => {
      return (
        <h1 id={slugify(children)} className="text-3xl font-semibold mt-6 mb-2" {...props}>
          {children}
        </h1>
      );
    },
    h2: ({ children, ...props }) => {
      return (
        <h2 id={slugify(children)} className="text-2xl font-semibold mt-6 mb-2" {...props}>
          {children}
        </h2>
      );
    },
    h3: ({ children, ...props }) => {
      return (
        <h3 id={slugify(children)} className="text-xl font-semibold mt-6 mb-2" {...props}>
          {children}
        </h3>
      );
    },
    h4: ({ children, ...props }) => {
      return (
        <h4 id={slugify(children)} className="text-lg font-semibold mt-6 mb-2" {...props}>
          {children}
        </h4>
      );
    },
    h5: ({ children, ...props }) => {
      return (
        <h5 id={slugify(children)} className="text-base font-semibold mt-6 mb-2" {...props}>
          {children}
        </h5>
      );
    },
    h6: ({ children, ...props }) => {
      return (
        <h6 id={slugify(children)} className="text-sm font-semibold mt-6 mb-2" {...props}>
          {children}
        </h6>
      );
    },
    table: ({ children, ...props }) => {
      return (
        <div className="overflow-x-auto my-4">
          <table className="w-full border-collapse border border-neutral-300 dark:border-neutral-700" {...props}>
            {children}
          </table>
        </div>
      );
    },
    thead: ({ children, ...props }) => {
      return (
        <thead className="bg-neutral-200 dark:bg-neutral-800" {...props}>
          {children}
        </thead>
      );
    },
    tbody: ({ children, ...props }) => {
      return <tbody {...props}>{children}</tbody>;
    },
    tr: ({ children, ...props }) => {
      return (
        <tr className="border-b border-neutral-300 dark:border-neutral-700" {...props}>
          {children}
        </tr>
      );
    },
    th: ({ children, ...props }) => {
      return (
        <th
          className="p-2 text-left font-semibold border-r last:border-r-0 border-neutral-300 dark:border-neutral-700"
          {...props}
        >
          {children}
        </th>
      );
    },
    td: ({ children, ...props }) => {
      return (
        <td className="p-2 border-r last:border-r-0 border-neutral-300 dark:border-neutral-700" {...props}>
          {children}
        </td>
      );
    },
    blockquote: ({ children, ...props }) => {
      return (
        <blockquote className="border-l-4 border-neutral-400 dark:border-neutral-600 pl-4 py-1 my-2 italic" {...props}>
          {children}
        </blockquote>
      );
    },
    hr: ({ ...props }) => {
      return <hr className="my-4 border-neutral-300 dark:border-neutral-700" {...props} />;
    },
    img: ({ src, alt, ...props }) => {
      return <img src={src} alt={alt || "Image"} className="max-h-60 my-2 rounded-md" loading="lazy" {...props} />;
    },
    code({ children, className, ...rest }) {
      const match = /language-(\w+)/.exec(className || "");
      const text = extractText(children).replace(/\n$/, "");
      const isMultiLine = text.includes("\n");

      if (!match && !isMultiLine) {
        return (
          <code
            {...rest}
            className={`${className || ""} bg-neutral-200 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono`}
          >
            {children}
          </code>
        );
      }

      const blockId = `${scopeId}:code:${blockIndex++}`;

      if (!match) {
        return <CodeRenderer key={blockId} code={text} language="text" blockId={blockId} isStreaming={isStreaming} />;
      }

      const language = match[1].toLowerCase();

      if (language === "latex" || language === "tex" || language === "math" || language === "katex") {
        const filename = extractFilename(text);
        return <LatexRenderer code={text} filename={filename} />;
      }

      if (language === "svg") {
        return <SvgRenderer svg={text} language={language} />;
      }

      if (language === "html" || language === "htm") {
        return <HtmlRenderer html={text} language={language} />;
      }

      if (language === "csv" || language === "tsv") {
        return <CsvRenderer csv={text} language={language} />;
      }

      if (language === "undefined" || language === "text" || language === "plain") {
        return <CodeRenderer key={blockId} code={text} language="text" blockId={blockId} isStreaming={isStreaming} />;
      }

      if (language === "markdown" || language === "md") {
        return <MarkdownRenderer content={text} language={language} />;
      }

      const filename = extractFilename(text);
      return (
        <CodeRenderer
          key={blockId}
          code={text}
          language={language}
          name={filename}
          blockId={blockId}
          isStreaming={isStreaming}
        />
      );
    },
  };
}

const katexPluginOptions: Parameters<typeof rehypeKatex>[0] = {
  strict: "ignore",
  errorColor: "transparent",
};

const baseRehypeReactOptions: Parameters<typeof rehypeReact>[0] = {
  Fragment,
  jsx,
  jsxs,
  ignoreInvalidStyle: true,
  passKeys: true,
  passNode: true,
};

const STREAM_RENDER_THROTTLE_MS = 120;

const findMatchingLinkDestinationEnd = (content: string, start: number): number => {
  let depth = 1;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const stabilizeStreamingLinks = (content: string): string => {
  const bracketStack: number[] = [];
  let inInlineCode = false;
  let inFence = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextThree = content.slice(index, index + 3);
    const lineStart = index === 0 || content[index - 1] === "\n";

    if (!inInlineCode && lineStart && nextThree === "```") {
      inFence = !inFence;
      index += 2;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (char === "`" && content[index - 1] !== "\\") {
      inInlineCode = !inInlineCode;
      continue;
    }

    if (inInlineCode) {
      continue;
    }

    if (char === "[") {
      bracketStack.push(index);
      continue;
    }

    if (char === "]" && content[index + 1] === "(" && bracketStack.length > 0) {
      const labelStart = bracketStack.pop();
      if (labelStart === undefined) {
        continue;
      }
      const label = content.slice(labelStart + 1, index);
      const destinationEnd = findMatchingLinkDestinationEnd(content, index + 2);

      if (destinationEnd === -1) {
        const imageStart = labelStart > 0 && content[labelStart - 1] === "!" ? labelStart - 1 : labelStart;
        return `${content.slice(0, imageStart)}${label}`;
      }
    }
  }

  return content;
};

const preprocessMarkdown = (content: string, isStreaming = false): string => {
  let processedContent = content;

  if (isStreaming) {
    processedContent = stabilizeStreamingLinks(processedContent);
  }

  // Convert LaTeX-style display math \[...\] to $$...$$
  processedContent = processedContent.replace(/\\\[([\s\S]+?)\\\]/g, (_match, mathContent) => {
    return `$$${mathContent}$$`;
  });

  // Convert LaTeX-style inline math \(...\) to $$...$$ (since single $ is disabled)
  processedContent = processedContent.replace(/\\\(([\s\S]+?)\\\)/g, (_match, mathContent) => {
    return `$$${mathContent}$$`;
  });

  // Ensure blank line before code blocks that come after headings
  processedContent = processedContent.replace(/^(#{1,6}\s+.+)\n```/gm, "$1\n\n```");

  // Ensure blank line after code blocks before headings
  processedContent = processedContent.replace(/```\n(#{1,6}\s+)/gm, "```\n\n$1");

  return processedContent;
};

function createMarkdownProcessor(scopeId: string, isStreaming: boolean) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkGemoji)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex, katexPluginOptions)
    .use(rehypeNotoEmoji)
    .use(rehypeReact, { ...baseRehypeReactOptions, components: createComponents(scopeId, isStreaming) });
}

type MarkdownProps = {
  children: string;
  isStreaming?: boolean;
};

let markdownInstanceCounter = 0;

const NonMemoizedMarkdown = ({ children, isStreaming = false }: MarkdownProps) => {
  const [throttled, setThrottled] = useState(children);
  const lastFlushRef = useRef(0);
  const timerRef = useRef<number>(undefined);
  const scopeIdRef = useRef<string | null>(null);

  if (!scopeIdRef.current) {
    scopeIdRef.current = `markdown-${markdownInstanceCounter++}`;
  }

  const processor = useMemo(
    () => createMarkdownProcessor(scopeIdRef.current ?? "markdown", isStreaming),
    [isStreaming],
  );

  useEffect(() => {
    if (!isStreaming) {
      window.clearTimeout(timerRef.current);
      return;
    }

    const delay = Math.max(0, STREAM_RENDER_THROTTLE_MS - (Date.now() - lastFlushRef.current));

    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      lastFlushRef.current = Date.now();
      setThrottled(children);
    }, delay);

    return () => window.clearTimeout(timerRef.current);
  }, [children, isStreaming]);

  // Throttle limits parse frequency during streaming; useDeferredValue
  // lets React interrupt long renders to keep the UI responsive.
  const input = useDeferredValue(isStreaming ? throttled : children);
  if (!input) return null;

  return processor.processSync(preprocessMarkdown(input, isStreaming)).result;
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prev, next) => prev.children === next.children && prev.isStreaming === next.isStreaming,
);

const extractFilename = (code: string): string | undefined => {
  const lines = code.split("\n");
  if (lines.length === 0) return undefined;

  const firstLine = lines[0].trim();

  // Pattern to match various comment styles with filepath
  const patterns = [
    /^\/\/\s*filepath:\s*(.+)$/i, // // filepath: main.go
    /^\/\/\s*file:\s*(.+)$/i, // // file: main.go
    /^#\s*filepath:\s*(.+)$/i, // # filepath: main.py
    /^#\s*file:\s*(.+)$/i, // # file: main.py
    /^<!--\s*filepath:\s*(.+?)\s*-->$/i, // <!-- filepath: index.html -->
    /^<!--\s*file:\s*(.+?)\s*-->$/i, // <!-- file: index.html -->
    /^\/\*\s*filepath:\s*(.+?)\s*\*\/$/i, // /* filepath: styles.css */
    /^\/\*\s*file:\s*(.+?)\s*\*\/$/i, // /* file: styles.css */
  ];

  for (const pattern of patterns) {
    const match = firstLine.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return undefined;
};
