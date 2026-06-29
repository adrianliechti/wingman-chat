import { useEffect, useState } from "react";
import { loadMermaid } from "@/shared/lib/lazy";
import { CodeEditor } from "./CodeEditor";

// Monotonic id so each render gets a unique mermaid element id.
let renderSeq = 0;

/**
 * Mermaid source normally arrives as raw text, but an artifact saved before
 * `.mmd` was mapped to a text MIME type (or an uploaded one) can come through as
 * a `data:` URL. Decode it back to text so mermaid sees the diagram, not the URL.
 */
function toDiagramText(content: string): string {
  if (!content.startsWith("data:")) return content;
  const comma = content.indexOf(",");
  if (comma === -1) return content;
  const meta = content.slice(5, comma);
  const data = content.slice(comma + 1);
  try {
    if (/;base64$/i.test(meta)) {
      const bin = atob(data);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(data);
  } catch {
    return content;
  }
}

/**
 * Renders Mermaid diagram source to SVG. `mermaid` is imported dynamically so it
 * lands in its own chunk (loaded only when a `.mmd` artifact is viewed) — and
 * once bundled it works offline, no CDN.
 */
function MermaidPreview({ content }: { content: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
        renderSeq += 1;
        const { svg: rendered } = await mermaid.render(`mermaid-${renderSeq}`, content);
        if (!cancelled) setSvg(rendered);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content]);

  if (error) {
    return (
      <div className="h-full overflow-auto p-4">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">Couldn't render this diagram</p>
        <pre className="mt-2 text-xs whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">{error}</pre>
      </div>
    );
  }

  if (svg == null) {
    return <div className="h-full flex items-center justify-center text-sm text-neutral-400">Rendering…</div>;
  }

  return (
    <div
      className="h-full overflow-auto p-4 flex items-start justify-center [&>svg]:max-w-full [&>svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

interface MermaidEditorProps {
  content: string;
  viewMode?: "code" | "preview";
  onViewModeChange?: (mode: "code" | "preview") => void;
}

export function MermaidEditor({ content, viewMode = "preview" }: MermaidEditorProps) {
  const text = toDiagramText(content);
  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-auto min-h-0">
        {viewMode === "preview" ? <MermaidPreview content={text} /> : <CodeEditor content={text} language="markdown" />}
      </div>
    </div>
  );
}
