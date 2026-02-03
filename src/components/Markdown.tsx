import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkGemoji from 'remark-gemoji';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { MermaidRenderer } from './MermaidRenderer';
import { CodeRenderer } from './CodeRenderer';
import { HtmlRenderer } from './HtmlRenderer';
import { CsvRenderer } from './CsvRenderer';
import { SvgRenderer } from './SvgRenderer';
import { MediaPlayer } from './MediaPlayer';
import { isAudioUrl, isVideoUrl } from '../lib/utils';

const components: Partial<Components> = {
    pre: ({ children }) => {
        return <>
            {children}
        </>;
    },
    li: ({ children, ...props }) => {
        return (
            <li className="py-1 ml-0" {...props}>
                {children}
            </li>
        );
    },
    ul: ({ children, ...props }) => {
        return (
            <ul className="list-disc list-outside ml-6 pl-0" {...props}>
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
        let url = href || '';

        if (url && !url.startsWith('http') && !url.startsWith('#')) {
            url = `https://${url}`;
        }

        // Check if this is an audio link
        if (isAudioUrl(url)) {
            return <MediaPlayer url={url} type="audio">{children}</MediaPlayer>;
        }

        // Check if this is a video link
        if (isVideoUrl(url)) {
            return <MediaPlayer url={url} type="video">{children}</MediaPlayer>;
        }
        
        return (
            <a
                className="text-blue-500 hover:underline"
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                {...props}
            >
                {children}
            </a>
        );
    },
    h1: ({ children, ...props }) => {
        return (
            <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
                {children}
            </h1>
        );
    },
    h2: ({ children, ...props }) => {
        return (
            <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
                {children}
            </h2>
        );
    },
    h3: ({ children, ...props }) => {
        return (
            <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
                {children}
            </h3>
        );
    },
    h4: ({ children, ...props }) => {
        return (
            <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
                {children}
            </h4>
        );
    },
    h5: ({ children, ...props }) => {
        return (
            <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
                {children}
            </h5>
        );
    },
    h6: ({ children, ...props }) => {
        return (
            <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
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
        return <tr className="border-b border-neutral-300 dark:border-neutral-700" {...props}>{children}</tr>;
    },
    th: ({ children, ...props }) => {
        return <th className="p-2 text-left font-semibold border-r last:border-r-0 border-neutral-300 dark:border-neutral-700" {...props}>{children}</th>;
    },
    td: ({ children, ...props }) => {
        return <td className="p-2 border-r last:border-r-0 border-neutral-300 dark:border-neutral-700" {...props}>{children}</td>;
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
        return (
            <img 
                src={src} 
                alt={alt || 'Image'} 
                className="max-h-60 my-2 rounded-md" 
                loading="lazy"
                {...props} 
            />
        );
    },
    code({ children, className, ...rest }) {
        const match = /language-(\w+)/.exec(className || "");
        
        // If no match but children contains newlines, it's likely a code block without language
        const text = String(children).replace(/\n$/, "");
        const isMultiLine = text.includes('\n');
        
        // Inline code (no language specified and single line)
        if (!match && !isMultiLine) {
            return (
                <code
                    {...rest}
                    className={`${className || ''} bg-neutral-200 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-sm font-mono`}
                    children={children}
                />
            );
        }

        // Code block without language - treat as markdown
        if (!match && isMultiLine) {
            return <Markdown>{text}</Markdown>;
        }

        // If no match, it's not a language-specific block, so we can't proceed with language checks.
        // This case should ideally not be hit if the above logic is correct, but as a safeguard:
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
                    strict: 'ignore',
                    errorColor: 'transparent',
                    trust: true,
                    fleqn: false,
                });
                
                return (
                    <div className="my-4">
                        {filename && (
                            <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 font-mono">
                                {filename}
                            </div>
                        )}
                        <div 
                            className="overflow-x-auto"
                            dangerouslySetInnerHTML={{ __html: html }}
                        />
                    </div>
                );
            } catch (error) {
                // If KaTeX fails, fall back to code renderer
                console.warn('KaTeX rendering failed:', error);
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

        // Default to markdown for common "plain text" languages
        if (language === "markdown" || language === "md" || language === "undefined" || language === "text" || language === "plain") {
            return <Markdown>{text}</Markdown>;
        }

        // Extract filename from code if present
        const filename = extractFilename(text);

        // Use CodeRenderer for all other code blocks
        return <CodeRenderer code={text} language={language} name={filename} />;
    },
};

// Disable single $ math to avoid conflicts with currency ($100, R$50, etc.)
// Use $$ for both inline and display math
const remarkPlugins: PluggableList = [
    remarkGfm, 
    remarkBreaks, 
    remarkGemoji, 
    [remarkMath, { singleDollarTextMath: false }],
];
const rehypePlugins: PluggableList = [
    rehypeRaw,
    rehypeSanitize,
    [
        rehypeKatex,
        {
            strict: 'ignore',
            throwOnError: false,
            errorColor: 'transparent',
        },
    ],
];

const NonMemoizedMarkdown = ({ children }: { children: string }) => {
    if (!children) return null;
    
    // Preprocess markdown to fix common formatting issues
    let processedContent = children;
    
    // Convert LaTeX-style display math \[...\] to $$...$$
    processedContent = processedContent.replace(/\\\[([^\]]+?)\\\]/g, (_match, content) => {
        return `$$${content}$$`;
    });
    
    // Convert LaTeX-style inline math \(...\) to $$...$$ (since single $ is disabled)
    processedContent = processedContent.replace(/\\\(([^)]+?)\\\)/g, (_match, content) => {
        return `$$${content}$$`;
    });
    
    // Ensure blank line before code blocks that come after headings
    processedContent = processedContent.replace(/^(#{1,6}\s+.+)\n```/gm, '$1\n\n```');
    
    // Ensure blank line after code blocks before headings
    processedContent = processedContent.replace(/```\n(#{1,6}\s+)/gm, '```\n\n$1');
    
    return (
        <ReactMarkdown 
            remarkPlugins={remarkPlugins} 
            components={components}
            rehypePlugins={rehypePlugins}
            remarkRehypeOptions={{ allowDangerousHtml: true }}
        >
            {processedContent}
        </ReactMarkdown>
    );
};

export const Markdown = memo(
    NonMemoizedMarkdown,
    (prevProps, nextProps) => prevProps.children === nextProps.children,
);

const extractFilename = (code: string): string | undefined => {
    const lines = code.split('\n');
    if (lines.length === 0) return undefined;
    
    const firstLine = lines[0].trim();
    
    // Pattern to match various comment styles with filepath
    const patterns = [
        /^\/\/\s*filepath:\s*(.+)$/i,           // // filepath: main.go
        /^\/\/\s*file:\s*(.+)$/i,               // // file: main.go
        /^#\s*filepath:\s*(.+)$/i,              // # filepath: main.py
        /^#\s*file:\s*(.+)$/i,                  // # file: main.py
        /^<!--\s*filepath:\s*(.+?)\s*-->$/i,    // <!-- filepath: index.html -->
        /^<!--\s*file:\s*(.+?)\s*-->$/i,        // <!-- file: index.html -->
        /^\/\*\s*filepath:\s*(.+?)\s*\*\/$/i,   // /* filepath: styles.css */
        /^\/\*\s*file:\s*(.+?)\s*\*\/$/i,       // /* file: styles.css */
    ];
    
    for (const pattern of patterns) {
        const match = firstLine.match(pattern);
        if (match) {
            return match[1].trim();
        }
    }
    
    return undefined;
};
