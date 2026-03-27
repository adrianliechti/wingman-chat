import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { unified } from "unified";
import rehypeReact from "rehype-react";
import type { Components } from "hast-util-to-jsx-runtime";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkGemoji from "remark-gemoji";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import katex from "katex";
import "katex/dist/katex.min.css";
import rehypeNotoEmoji from "@/shared/lib/rehype-noto-emoji";
import { MermaidRenderer } from "./renderers/MermaidRenderer";
import { CodeRenderer } from "./CodeRenderer";
import { HtmlRenderer } from "./renderers/HtmlRenderer";
import { CsvRenderer } from "./renderers/CsvRenderer";
import { SvgRenderer } from "./renderers/SvgRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MediaPlayer } from "./MediaPlayer";
import { isAudioUrl, isVideoUrl } from "@/shared/lib/utils";
import type { ReactNode } from "react";

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

const components: Partial<Components> = {
  pre: ({ children }) => {
    return <>{children}</>;
  },
  input: ({ type, checked, ...props }) => {
    if (type === "checkbox") {
      return (
        <svg className={`task-checkbox${checked ? " checked" : ""}`} viewBox="0 0 16 16" fill="none" role="checkbox" aria-checked={checked} {...props}>
          <rect x="1" y="1" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
          {checked && <path d="M4.5 8L7 10.5L11.5 5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
      );
    }
    return <input type={type} checked={checked} {...props} />;
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
      <ol className="list-decimal list-outside ml-6 pl-0" {...props}>
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

    // Check if this is an audio link
    if (isAudioUrl(url)) {
      return (
        <MediaPlayer url={url} type="audio">
          {children}
        </MediaPlayer>
      );
    }

    // Check if this is a video link
    if (isVideoUrl(url)) {
      return (
        <MediaPlayer url={url} type="video">
          {children}
        </MediaPlayer>
      );
    }

    // Anchor links scroll within the page
    if (internalHash) {
      return (
        <a
          className="hover:underline"
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
      <a className="hover:underline" href={url} target="_blank" rel="noreferrer noopener" {...props}>
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
      <th className="p-2 text-left font-semibold border-r last:border-r-0 border-neutral-300 dark:border-neutral-700" {...props}>
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

    // If no match but children contains newlines, it's likely a code block without language
    const text = extractText(children).replace(/\n$/, "");
    const isMultiLine = text.includes("\n");

    // Inline code (no language specified and single line)
    if (!match && !isMultiLine) {
      return <code {...rest} className={`${className || ""} bg-neutral-200 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono`} children={children} />;
    }

    // Code block without language - render as plain text
    if (!match) {
      return <CodeRenderer code={text} language="text" />;
    }

    const language = match[1].toLowerCase();

    if (language === "latex" || language === "tex" || language === "math" || language === "katex") {
      // Extract filename if present (e.g., % filepath: navier-stokes.tex)
      const filename = extractFilename(text);

      try {
        // Render LaTeX using KaTeX in display mode
        const html = katex.renderToString(text, {
          displayMode: true,
          throwOnError: false,
          strict: "ignore",
          errorColor: "transparent",
          trust: true,
          fleqn: false,
        });

        return (
          <div className="my-4">
            {filename && <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 font-mono">{filename}</div>}
            <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        );
      } catch (error) {
        // If KaTeX fails, fall back to code renderer
        console.warn("KaTeX rendering failed:", error);
        return <CodeRenderer code={text} language="latex" name={filename} />;
      }
    }

    if (language === "mermaid" || language === "mmd") {
      return <MermaidRenderer chart={text} language={language} />;
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

    // Plain text languages - render as text code block
    if (language === "undefined" || language === "text" || language === "plain") {
      return <CodeRenderer code={text} language="text" />;
    }

    // Markdown code blocks - render content as markdown
    if (language === "markdown" || language === "md") {
      return <MarkdownRenderer content={text} language={language} />;
    }

    // Extract filename from code if present
    const filename = extractFilename(text);

    // Use CodeRenderer for all other code blocks
    return <CodeRenderer code={text} language={language} name={filename} />;
  },
};

const katexPluginOptions: Parameters<typeof rehypeKatex>[0] = {
  strict: "ignore",
  errorColor: "transparent",
};

const rehypeReactOptions: Parameters<typeof rehypeReact>[0] = {
  Fragment,
  jsx,
  jsxs,
  components,
  ignoreInvalidStyle: true,
  passKeys: true,
  passNode: true,
};

const STREAM_RENDER_THROTTLE_MS = 120;

const preprocessMarkdown = (content: string): string => {
  let processedContent = content;

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

// Build the processor once at module scope.
// Disable single $ math to avoid conflicts with currency ($100, R$50, etc.)
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkGemoji)
  .use(remarkMath, { singleDollarTextMath: false })
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeKatex, katexPluginOptions)
  .use(rehypeNotoEmoji)
  .use(rehypeReact, rehypeReactOptions);

type MarkdownProps = {
  children: string;
  isStreaming?: boolean;
};

const NonMemoizedMarkdown = ({ children, isStreaming = false }: MarkdownProps) => {
  const [throttled, setThrottled] = useState(children);
  const lastFlushRef = useRef(0);
  const timerRef = useRef<number>(undefined);

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

  return processor.processSync(preprocessMarkdown(input)).result;
};

export const Markdown = memo(NonMemoizedMarkdown, (prev, next) => prev.children === next.children && prev.isStreaming === next.isStreaming);

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
